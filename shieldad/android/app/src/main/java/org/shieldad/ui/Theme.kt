package org.shieldad.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Light = lightColorScheme(
    primary = Color(0xFF137A4D), onPrimary = Color.White,
    primaryContainer = Color(0xFFDDF4E6), onPrimaryContainer = Color(0xFF073E25),
    secondary = Color(0xFF466353), surface = Color(0xFFF7FAF8),
    surfaceVariant = Color(0xFFE8EFEB), error = Color(0xFFB3261E)
)
private val Dark = darkColorScheme(
    primary = Color(0xFF62D699), onPrimary = Color(0xFF06371F),
    primaryContainer = Color(0xFF145537), onPrimaryContainer = Color(0xFFDDF4E6),
    secondary = Color(0xFFA4C7B1), surface = Color(0xFF101713),
    surfaceVariant = Color(0xFF202C25), error = Color(0xFFFFB4AB)
)

@Composable
fun ShieldAdTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
