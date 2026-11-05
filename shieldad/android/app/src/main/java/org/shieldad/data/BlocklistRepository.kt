package org.shieldad.data

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import org.shieldad.dns.DnsListParser
import org.shieldad.dns.DomainMatcher

class BlocklistRepository(private val context: Context, private val settings: SettingsRepository) {
    private val updateFile by lazy { File(context.filesDir, "blocklist-update.txt") }

    suspend fun loadMatcher(): DomainMatcher = withContext(Dispatchers.IO) {
        val domains = HashSet<String>()
        context.assets.open("blocklist.txt").bufferedReader().use { reader ->
            reader.forEachLine { line -> if (line.isNotBlank()) domains += line.trim().lowercase() }
        }
        if (updateFile.exists()) domains += DnsListParser.parse(updateFile.readText())
        val value = settings.settings.first()
        DomainMatcher(
            blocklist = domains,
            customList = DnsListParser.parse(value.customBlocklist),
            allowlist = DnsListParser.parse(value.allowlist)
        )
    }

    suspend fun updateBlocklists(): Int = withContext(Dispatchers.IO) {
        val sources = listOf(
            "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
            "https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_general_block.txt",
            "https://raw.githubusercontent.com/easylist/easylist/master/easyprivacy/easyprivacy_general.txt"
        )
        val domains = HashSet<String>()
        for (source in sources) {
            val connection = (URL(source).openConnection() as HttpURLConnection).apply {
                connectTimeout = 20_000
                readTimeout = 60_000
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "ShieldAd-Android/1.0")
            }
            try {
                val response = connection.responseCode
                if (response !in 200..299) error("List server returned HTTP $response")
                domains += DnsListParser.parse(connection.inputStream.bufferedReader().use { it.readText() })
            } finally {
                connection.disconnect()
            }
        }
        if (domains.size < 100) error("Downloaded blocklist is unexpectedly small")
        val temporary = File(updateFile.parentFile, "blocklist-update.tmp")
        temporary.writeText(domains.sorted().joinToString("\n", postfix = "\n"))
        if (!temporary.renameTo(updateFile)) {
            temporary.copyTo(updateFile, overwrite = true)
            temporary.delete()
        }
        domains.size
    }
}
