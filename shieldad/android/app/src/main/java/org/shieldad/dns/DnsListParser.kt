package org.shieldad.dns

object DnsListParser {
    private val networkDomain = Regex("^\\|\\|([a-z0-9.-]+)\\^(?:\\$.*)?$", RegexOption.IGNORE_CASE)
    private val domain = Regex("^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", RegexOption.IGNORE_CASE)

    fun parse(text: String): Set<String> {
        val result = HashSet<String>()
        text.lineSequence().forEach { raw ->
            val line = raw.substringBefore('#').trim()
            if (line.isEmpty()) return@forEach
            val match = networkDomain.matchEntire(line)
            val candidate = when {
                match != null -> match.groupValues[1]
                else -> {
                    val columns = line.split(Regex("\\s+"))
                    if (columns.size >= 2 && columns[0] in setOf("0.0.0.0", "127.0.0.1", "::", "::1")) columns[1]
                    else if (columns.size == 1) columns[0] else null
                }
            }?.lowercase()?.removeSuffix(".")
            if (candidate != null && candidate !in setOf("localhost", "localhost.localdomain", "broadcasthost") && domain.matches(candidate)) result += candidate
        }
        return result
    }
}
