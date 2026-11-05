package org.shieldad.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "shieldad-settings")

data class AppSettings(
    val upstreamDns: String = "1.1.1.1",
    val customBlocklist: String = "",
    val allowlist: String = "",
    val restartOnBoot: Boolean = false,
    val warningAcknowledged: Boolean = false,
    val excludedApps: Set<String> = emptySet()
)

class SettingsRepository(private val context: Context) {
    private object Keys {
        val upstream = stringPreferencesKey("upstream_dns")
        val custom = stringPreferencesKey("custom_blocklist")
        val allow = stringPreferencesKey("allowlist")
        val boot = booleanPreferencesKey("restart_on_boot")
        val warning = booleanPreferencesKey("warning_acknowledged")
        val excluded = stringSetPreferencesKey("excluded_apps")
    }

    val settings: Flow<AppSettings> = context.dataStore.data.map { value ->
        AppSettings(
            upstreamDns = value[Keys.upstream] ?: "1.1.1.1",
            customBlocklist = value[Keys.custom] ?: "",
            allowlist = value[Keys.allow] ?: "",
            restartOnBoot = value[Keys.boot] ?: false,
            warningAcknowledged = value[Keys.warning] ?: false,
            excludedApps = value[Keys.excluded] ?: emptySet()
        )
    }

    suspend fun setUpstream(value: String) = context.dataStore.edit { it[Keys.upstream] = value }
    suspend fun setCustomBlocklist(value: String) = context.dataStore.edit { it[Keys.custom] = value }
    suspend fun setAllowlist(value: String) = context.dataStore.edit { it[Keys.allow] = value }
    suspend fun setRestartOnBoot(value: Boolean) = context.dataStore.edit { it[Keys.boot] = value }
    suspend fun setWarningAcknowledged() = context.dataStore.edit { it[Keys.warning] = true }
    suspend fun setExcludedApps(value: Set<String>) = context.dataStore.edit { it[Keys.excluded] = value }
}
