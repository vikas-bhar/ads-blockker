package org.shieldad

import android.app.Application
import android.content.Intent
import android.content.pm.PackageManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.shieldad.data.AppSettings
import org.shieldad.data.QueryLogEntity
import org.shieldad.service.ShieldVpnService

data class InstalledApp(val packageName: String, val label: String)

class ShieldAdViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as ShieldAdApplication
    val settings = app.settings.settings.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), AppSettings())
    val logs: StateFlow<List<QueryLogEntity>> = app.stats.recent.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val totalBlocked = app.stats.totalBlocked.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0L)
    val blockedToday = app.stats.blockedToday.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0L)
    val running = ShieldVpnService.running

    private val _apps = MutableStateFlow<List<InstalledApp>>(emptyList())
    val apps = _apps.asStateFlow()
    private val _updateInProgress = MutableStateFlow(false)
    val updateInProgress = _updateInProgress.asStateFlow()
    private val _updateStatus = MutableStateFlow<String?>(null)
    val updateStatus = _updateStatus.asStateFlow()

    init {
        viewModelScope.launch(Dispatchers.IO) {
            val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val packageManager = application.packageManager
            val resolved = packageManager.queryIntentActivities(intent, PackageManager.MATCH_ALL)
            _apps.value = resolved.mapNotNull { item ->
                val info = item.activityInfo ?: return@mapNotNull null
                if (info.packageName == application.packageName) null
                else InstalledApp(info.packageName, item.loadLabel(packageManager).toString())
            }.distinctBy { it.packageName }.sortedBy { it.label.lowercase() }
        }
    }

    fun acknowledgeWarning() = viewModelScope.launch { app.settings.setWarningAcknowledged() }
    fun setUpstream(value: String) = viewModelScope.launch { app.settings.setUpstream(value) }
    fun setCustomBlocklist(value: String) = viewModelScope.launch { app.settings.setCustomBlocklist(value) }
    fun setAllowlist(value: String) = viewModelScope.launch { app.settings.setAllowlist(value) }
    fun setRestartOnBoot(value: Boolean) = viewModelScope.launch { app.settings.setRestartOnBoot(value) }

    fun toggleExcluded(packageName: String) = viewModelScope.launch {
        val current = settings.value.excludedApps
        app.settings.setExcludedApps(if (packageName in current) current - packageName else current + packageName)
    }

    fun updateLists() = viewModelScope.launch {
        if (_updateInProgress.value) return@launch
        _updateInProgress.value = true
        _updateStatus.value = null
        try {
            val count = app.blocklists.updateBlocklists()
            _updateStatus.value = "$count domains downloaded. Restart protection to load them."
        } catch (error: Exception) {
            _updateStatus.value = "Update failed: ${error.message ?: "network error"}"
        } finally {
            _updateInProgress.value = false
        }
    }
}
