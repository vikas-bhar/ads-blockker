package org.shieldad

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.viewmodel.compose.viewModel
import org.shieldad.ui.ShieldAdApp
import org.shieldad.ui.ShieldAdTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            if (Build.VERSION.SDK_INT >= 33) {
                val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
                androidx.compose.runtime.LaunchedEffect(Unit) { notifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
            }
            ShieldAdTheme {
                val model: ShieldAdViewModel = viewModel()
                ShieldAdApp(model)
            }
        }
    }
}
