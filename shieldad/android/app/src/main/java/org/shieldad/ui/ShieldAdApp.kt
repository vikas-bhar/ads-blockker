package org.shieldad.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.VpnService
import android.provider.Settings
import android.text.format.DateFormat
import android.util.Patterns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.util.Date
import org.shieldad.InstalledApp
import org.shieldad.ShieldAdViewModel
import org.shieldad.data.AppSettings
import org.shieldad.data.QueryLogEntity
import org.shieldad.service.ShieldVpnService

private data class Destination(val id: String, val label: String, val icon: ImageVector)
private val destinations = listOf(
    Destination("home", "Home", Icons.Default.Home),
    Destination("activity", "Activity", Icons.Default.Notifications),
    Destination("lists", "Lists", Icons.Default.List),
    Destination("apps", "Apps", Icons.Default.Apps),
    Destination("settings", "Settings", Icons.Default.Settings)
)

@Composable
fun ShieldAdApp(model: ShieldAdViewModel) {
    val settings by model.settings.collectAsStateWithLifecycle()
    if (!settings.warningAcknowledged) {
        WarningScreen(onContinue = { model.acknowledgeWarning() })
        return
    }
    var current by remember { mutableStateOf("home") }
    Scaffold(
        bottomBar = {
            NavigationBar {
                destinations.forEach { destination ->
                    NavigationBarItem(
                        selected = current == destination.id,
                        onClick = { current = destination.id },
                        icon = { Icon(destination.icon, contentDescription = destination.label) },
                        label = { Text(destination.label) }
                    )
                }
            }
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (current) {
                "home" -> HomeScreen(model)
                "activity" -> ActivityScreen(model)
                "lists" -> ListsScreen(model)
                "apps" -> AppsScreen(model)
                else -> SettingsScreen(model)
            }
        }
    }
}

@Composable
private fun ScreenHeader(title: String, subtitle: String) {
    Column(Modifier.padding(horizontal = 22.dp, vertical = 18.dp)) {
        Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun HomeScreen(model: ShieldAdViewModel) {
    val running by model.running.collectAsStateWithLifecycle()
    val today by model.blockedToday.collectAsStateWithLifecycle()
    val total by model.totalBlocked.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) ShieldVpnService.start(context)
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
        ScreenHeader("ShieldAd", "A quieter Internet, on your device")
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = {
                if (running) ShieldVpnService.stop(context)
                else VpnService.prepare(context)?.let(permission::launch) ?: ShieldVpnService.start(context)
            },
            modifier = Modifier.size(174.dp),
            shape = CircleShape,
            contentPadding = PaddingValues(0.dp)
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(if (running) Icons.Default.Lock else Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(34.dp))
                Spacer(Modifier.height(8.dp))
                Text(if (running) "STOP" else "START", fontWeight = FontWeight.Bold)
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(if (running) "Protection is active" else "Protection is off", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text("Local DNS-only VPN • 10.111.222.2", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth().padding(22.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MetricCard("Blocked today", today, Modifier.weight(1f))
            MetricCard("Total blocked", total, Modifier.weight(1f))
        }
        Card(Modifier.fillMaxWidth().padding(horizontal = 22.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
            Row(Modifier.padding(17.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.CheckCircle, contentDescription = null)
                Spacer(Modifier.width(12.dp))
                Text("Only DNS queries enter the tunnel. ShieldAd never proxies your app or web traffic.", style = MaterialTheme.typography.bodySmall)
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun MetricCard(label: String, value: Long, modifier: Modifier = Modifier) {
    Card(modifier, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(18.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(5.dp))
            Text("%,d".format(value), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ActivityScreen(model: ShieldAdViewModel) {
    val logs by model.logs.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("DNS activity", "The last 100 queries, stored only on this device")
        if (logs.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No DNS queries yet", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        } else LazyColumn(contentPadding = PaddingValues(horizontal = 18.dp, vertical = 4.dp)) {
            items(logs, key = { it.id }) { entry -> QueryRow(entry) }
        }
    }
}

@Composable
private fun QueryRow(entry: QueryLogEntity) {
    Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(entry.domain, style = MaterialTheme.typography.bodyMedium, color = if (entry.blocked) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
            Text(if (entry.blocked) "Blocked" else "Forwarded", style = MaterialTheme.typography.labelSmall, color = if (entry.blocked) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(DateFormat.getTimeFormat(LocalContext.current).format(Date(entry.timestamp)), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    HorizontalDivider()
}

@Composable
private fun ListsScreen(model: ShieldAdViewModel) {
    val settings by model.settings.collectAsStateWithLifecycle()
    val updating by model.updateInProgress.collectAsStateWithLifecycle()
    val updateStatus by model.updateStatus.collectAsStateWithLifecycle()
    var custom by remember(settings.customBlocklist) { mutableStateOf(settings.customBlocklist) }
    var allowed by remember(settings.allowlist) { mutableStateOf(settings.allowlist) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        ScreenHeader("Your filters", "Custom domains take effect after protection restarts")
        ListEditor("Custom block list", "One domain per line\nads.example.com", custom, { custom = it }, { model.setCustomBlocklist(custom) })
        ListEditor("Allowlist", "One domain per line\ntrusted.example.com", allowed, { allowed = it }, { model.setAllowlist(allowed) })
        Column(Modifier.padding(horizontal = 22.dp, vertical = 12.dp)) {
            Button(onClick = { model.updateLists() }, enabled = !updating, modifier = Modifier.fillMaxWidth()) {
                if (updating) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Icon(Icons.Default.Refresh, contentDescription = null)
                Spacer(Modifier.width(8.dp)); Text(if (updating) "Updating…" else "Update blocklists")
            }
            updateStatus?.let { Text(it, Modifier.padding(top = 10.dp), style = MaterialTheme.typography.bodySmall) }
            Text("EasyList, EasyPrivacy, and StevenBlack are also updated weekly by WorkManager.", Modifier.padding(top = 10.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ListEditor(title: String, placeholder: String, value: String, onChange: (String) -> Unit, onSave: () -> Unit) {
    Column(Modifier.padding(horizontal = 22.dp, vertical = 10.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value, onChange, Modifier.fillMaxWidth().height(150.dp), placeholder = { Text(placeholder) }, textStyle = MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick = onSave, Modifier.align(Alignment.End).padding(top = 7.dp)) { Text("Save list") }
    }
}

@Composable
private fun AppsScreen(model: ShieldAdViewModel) {
    val apps by model.apps.collectAsStateWithLifecycle()
    val settings by model.settings.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Per-app bypass", "Excluded apps bypass the VPN entirely; restart protection after changes")
        LazyColumn(contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp)) {
            items(apps, key = InstalledApp::packageName) { app ->
                Row(Modifier.fillMaxWidth().padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(app.label, style = MaterialTheme.typography.bodyLarge)
                        Text(app.packageName, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = app.packageName in settings.excludedApps, onCheckedChange = { model.toggleExcluded(app.packageName) })
                }
                HorizontalDivider()
            }
        }
    }
}

@Composable
private fun SettingsScreen(model: ShieldAdViewModel) {
    val settings by model.settings.collectAsStateWithLifecycle()
    var customDns by remember(settings.upstreamDns) { mutableStateOf(settings.upstreamDns) }
    val presets = listOf("Cloudflare • 1.1.1.1" to "1.1.1.1", "Google • 8.8.8.8" to "8.8.8.8", "Quad9 • 9.9.9.9" to "9.9.9.9")
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        ScreenHeader("Settings", "Upstream DNS receives allowed queries only")
        Text("Upstream resolver", Modifier.padding(horizontal = 22.dp), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        presets.forEach { (label, address) ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected = settings.upstreamDns == address, onClick = { model.setUpstream(address) })
                Text(label)
            }
        }
        Column(Modifier.padding(horizontal = 22.dp, vertical = 8.dp)) {
            OutlinedTextField(customDns, { customDns = it }, Modifier.fillMaxWidth(), label = { Text("Custom DNS IP") }, singleLine = true)
            OutlinedButton(
                onClick = { model.setUpstream(customDns.trim()) },
                enabled = Patterns.IP_ADDRESS.matcher(customDns.trim()).matches(),
                modifier = Modifier.align(Alignment.End).padding(top = 7.dp)
            ) { Text("Use custom resolver") }
            Text("Changes take effect after restarting protection.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        HorizontalDivider(Modifier.padding(vertical = 12.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Restart on boot", style = MaterialTheme.typography.titleMedium)
                Text("Starts only if Android still grants VPN access", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Switch(checked = settings.restartOnBoot, onCheckedChange = { model.setRestartOnBoot(it) })
        }
        OutlinedButton(onClick = { openPrivateDnsSettings(context) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 10.dp)) {
            Icon(Icons.Default.Info, contentDescription = null); Spacer(Modifier.width(8.dp)); Text("Check Android Private DNS")
        }
        Text("Private DNS must be Off or Automatic. A named DNS-over-TLS provider bypasses local DNS filtering.", Modifier.padding(horizontal = 22.dp, vertical = 6.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("ShieldAd 1.0.0 • Open source • No analytics", Modifier.fillMaxWidth().padding(24.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}

@Composable
private fun WarningScreen(onContinue: () -> Unit) {
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(28.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(62.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(20.dp))
        Text("Before you enable ShieldAd", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Text("ShieldAd filters DNS inside a local VPN. No browsing traffic or personal data is sent to ShieldAd.", Modifier.padding(top = 12.dp), textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Card(Modifier.fillMaxWidth().padding(vertical = 24.dp), shape = RoundedCornerShape(18.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
            Column(Modifier.padding(20.dp)) {
                Text("Important: Android Private DNS", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text("Private DNS must be set to Off or Automatic for blocking to work. A named DNS-over-TLS provider bypasses the local DNS tunnel.", Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodyMedium)
            }
        }
        FilledTonalButton(onClick = { openPrivateDnsSettings(context) }, modifier = Modifier.fillMaxWidth()) { Text("Open system settings") }
        Spacer(Modifier.height(10.dp))
        Button(onClick = onContinue, modifier = Modifier.fillMaxWidth()) { Text("I understand, continue") }
    }
}

private fun openPrivateDnsSettings(context: android.content.Context) {
    val intent = Intent("android.settings.PRIVATE_DNS_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try { context.startActivity(intent) }
    catch (_: ActivityNotFoundException) { context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}
