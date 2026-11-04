package org.shieldad

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit
import org.shieldad.data.BlocklistRepository
import org.shieldad.data.QueryDatabase
import org.shieldad.data.SettingsRepository
import org.shieldad.data.StatsRepository
import org.shieldad.work.UpdateBlocklistWorker

class ShieldAdApplication : Application() {
    val settings by lazy { SettingsRepository(this) }
    val database by lazy { QueryDatabase.create(this) }
    val stats by lazy { StatsRepository(database) }
    val blocklists by lazy { BlocklistRepository(this, settings) }

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("dns-protection", "DNS protection", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Persistent status for ShieldAd's local DNS VPN"
            setShowBadge(false)
        })
        manager.createNotificationChannel(NotificationChannel("filter-updates", "Filter updates", NotificationManager.IMPORTANCE_DEFAULT))
        val request = PeriodicWorkRequestBuilder<UpdateBlocklistWorker>(7, TimeUnit.DAYS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("weekly-blocklist-update", ExistingPeriodicWorkPolicy.KEEP, request)
    }
}
