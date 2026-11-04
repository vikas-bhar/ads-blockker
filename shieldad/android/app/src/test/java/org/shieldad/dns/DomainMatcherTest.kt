package org.shieldad.dns

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DomainMatcherTest {
    private val matcher = DomainMatcher(
        blocklist = setOf("ads.example.com", "tracker.test"),
        customList = setOf("custom.test"),
        allowlist = setOf("safe.ads.example.com")
    )

    @Test fun `matches exact domains and parents`() {
        assertTrue(matcher.isBlocked("ads.example.com"))
        assertTrue(matcher.isBlocked("pixel.ads.example.com"))
        assertTrue(matcher.isBlocked("a.b.custom.test"))
        assertFalse(matcher.isBlocked("notads.example.com"))
        assertFalse(matcher.isBlocked("example.com"))
    }

    @Test fun `allowlist overrides every block source and normalizes case`() {
        assertFalse(matcher.isBlocked("SAFE.ADS.EXAMPLE.COM."))
        assertFalse(matcher.isBlocked("x.safe.ads.example.com"))
        assertTrue(matcher.isBlocked("other.ads.example.com"))
    }
}
