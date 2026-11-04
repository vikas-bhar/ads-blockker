package org.shieldad.service

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.ParcelFileDescriptor
import androidx.core.app.NotificationCompat
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import kotlin.concurrent.thread
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.shieldad.MainActivity
import org.shieldad.R
import org.shieldad.ShieldAdApplication
import org.shieldad.dns.DnsPacket
import org.shieldad.dns.DnsQuery
import org.shieldad.dns.DnsResponseCache
import org.shieldad.dns.DomainMatcher
import org.shieldad.dns.UdpDnsPacket

/** A DNS-only tunnel. No application payload traffic is accepted or proxied. */
class ShieldVpnService : VpnService() {
    private val dispatcher = Executors.newFixedThreadPool(4).asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)
    private val workers = Semaphore(32)
    private val cache = DnsResponseCache()
    private val writeLock = Any()
    private var tunnel: ParcelFileDescriptor? = null
    private var output: FileOutputStream? = null
    private var reader: Thread? = null
    private var matcher: DomainMatcher? = null
    private var upstream = "1.1.1.1"

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            shutdown()
            return START_NOT_STICKY
        }
        if (tunnel != null) return START_STICKY
        startForeground(NOTIFICATION_ID, notification("Preparing local DNS protection…"))
        scope.launch {
            try {
                val app = application as ShieldAdApplication
                val settings = app.settings.settings.first()
                matcher = app.blocklists.loadMatcher()
                upstream = settings.upstreamDns
                val builder = Builder()
                    .setSession("ShieldAd DNS")
                    .setMtu(4096)
                    .addAddress("10.111.222.1", 32)
                    .addAddress("fd00::1", 128)
                    .addDnsServer("10.111.222.2")
                    .addDnsServer("fd00::2")
                    // These are deliberately the only routes: only packets addressed to the
                    // virtual DNS resolvers can enter the TUN interface.
                    .addRoute("10.111.222.2", 32)
                    .addRoute("fd00::2", 128)
                settings.excludedApps.forEach { packageName ->
                    try { builder.addDisallowedApplication(packageName) } catch (_: PackageManager.NameNotFoundException) { }
                }
                val established = builder.establish() ?: error("Android VPN permission is unavailable")
                tunnel = established
                output = FileOutputStream(established.fileDescriptor)
                _running.value = true
                updateNotification("Blocking ads through local DNS")
                reader = thread(name = "ShieldAd-TUN", isDaemon = true) { readPackets(established) }
            } catch (error: Exception) {
                if (error !is CancellationException) error.printStackTrace()
                shutdown()
            }
        }
        return START_STICKY
    }

    private fun readPackets(established: ParcelFileDescriptor) {
        val input = FileInputStream(established.fileDescriptor)
        try {
            while (tunnel === established && !Thread.currentThread().isInterrupted) {
                val buffer = ByteArray(65535)
                val length = input.read(buffer)
                if (length < 0) break
                if (length == 0) continue
                val packet = DnsPacket.parseIpUdp(buffer, length) ?: continue
                if (packet.destinationPort != 53) continue
                val query = DnsPacket.parseDnsQuery(packet.dnsPayload) ?: continue
                if (!workers.tryAcquire()) continue
                scope.launch {
                    try { process(packet, query) } finally { workers.release() }
                }
            }
        } catch (_: Exception) {
            // Closing the TUN descriptor is the normal way the blocking read is interrupted.
        }
    }

    private suspend fun process(packet: UdpDnsPacket, query: DnsQuery) {
        val blocked = matcher?.isBlocked(query.domain) == true
        val response = try {
            if (blocked) {
                if (query.type == DnsPacket.TYPE_A || query.type == DnsPacket.TYPE_AAAA) DnsPacket.buildBlockedResponse(query)
                else DnsPacket.buildEmptyResponse(query)
            } else {
                val key = "${query.domain}/${query.type}/${query.queryClass}"
                cache.get(key, query.id) ?: forward(query).also { answer ->
                    // Do not cache failures or truncated UDP answers.
                    if (answer.size >= 4 && (answer[3].toInt() and 0x0f) == 0 && (answer[2].toInt() and 0x02) == 0) cache.put(key, answer)
                }
            }
        } catch (_: Exception) {
            DnsPacket.buildEmptyResponse(query, responseCode = 2) // SERVFAIL
        }
        val responsePacket = DnsPacket.buildIpUdpResponse(packet, response)
        synchronized(writeLock) { output?.write(responsePacket) }
        (application as ShieldAdApplication).stats.record(query.domain, blocked)
    }

    private fun forward(query: DnsQuery): ByteArray {
        val socket = DatagramSocket()
        socket.use {
            // protect() excludes this upstream socket from the VPN. The raw DNS query is
            // sent unchanged and no application payload is ever forwarded.
            protect(it)
            it.soTimeout = 5000
            it.connect(InetAddress.getByName(upstream), 53)
            it.send(DatagramPacket(query.raw, query.raw.size))
            val answer = DatagramPacket(ByteArray(65535), 65535)
            it.receive(answer)
            if (answer.length < 12) error("Short DNS answer")
            val payload = answer.data.copyOf(answer.length)
            val id = (payload[0].toInt() and 255) shl 8 or (payload[1].toInt() and 255)
            if (id != query.id || (payload[2].toInt() and 0x80) == 0) error("Invalid upstream DNS answer")
            return payload
        }
    }

    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, ShieldVpnService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, "dns-protection")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("ShieldAd is active")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(0, "Stop", stop)
            .build()
    }

    private fun updateNotification(text: String) {
        startForeground(NOTIFICATION_ID, notification(text))
    }

    private fun shutdown() {
        _running.value = false
        scope.coroutineContext.cancelChildren()
        val established = tunnel
        tunnel = null
        reader?.interrupt()
        reader = null
        runCatching { output?.close() }
        runCatching { established?.close() }
        output = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onRevoke() {
        shutdown()
        super.onRevoke()
    }

    override fun onDestroy() {
        _running.value = false
        runCatching { output?.close() }
        runCatching { tunnel?.close() }
        tunnel = null
        scope.cancel()
        dispatcher.close()
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "org.shieldad.action.STOP"
        private const val NOTIFICATION_ID = 42
        private val _running = MutableStateFlow(false)
        val running = _running.asStateFlow()

        fun start(context: Context) {
            val intent = Intent(context, ShieldVpnService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.startService(Intent(context, ShieldVpnService::class.java).setAction(ACTION_STOP))
        }
    }
}
