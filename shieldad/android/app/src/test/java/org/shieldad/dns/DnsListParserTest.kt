package org.shieldad.dns

import org.junit.Assert.assertEquals
import org.junit.Test

class DnsListParserTest {
    @Test fun `deduplicates hosts and network domains`() {
        val parsed = DnsListParser.parse("""
            0.0.0.0 ads.example.com
            127.0.0.1 tracker.example.com # comment
            ||ads.example.com^
            ||cdn.example.org^${'$'}third-party
            */do-not-extract-domains/*
            0.0.0.0 localhost
        """.trimIndent())
        assertEquals(setOf("ads.example.com", "tracker.example.com", "cdn.example.org"), parsed)
    }
}
