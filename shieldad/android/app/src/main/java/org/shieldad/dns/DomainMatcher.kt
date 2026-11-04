package org.shieldad.dns

/** Matches a domain and every parent domain, with allowlist precedence. */
class DomainMatcher(
    blocklist: Set<String>,
    customList: Set<String> = emptySet(),
    allowlist: Set<String> = emptySet()
) {
    private val blocklist = blocklist.mapTo(HashSet()) { normalize(it) }
    private val custom = customList.mapTo(HashSet()) { normalize(it) }
    private val allowed = allowlist.mapTo(HashSet()) { normalize(it) }

    fun isBlocked(domain: String): Boolean {
        val candidate = normalize(domain)
        if (candidate.isEmpty() || hasMatch(candidate, allowed)) return false
        return hasMatch(candidate, blocklist) || hasMatch(candidate, custom)
    }

    private fun hasMatch(domain: String, set: Set<String>): Boolean {
        var current = domain
        while (true) {
            if (current in set) return true
            val dot = current.indexOf('.')
            if (dot < 0 || dot == current.lastIndex) return false
            current = current.substring(dot + 1)
        }
    }

    private fun normalize(domain: String) = domain.trim().lowercase().removeSuffix(".")

    val size: Int get() = blocklist.size + custom.size
}
