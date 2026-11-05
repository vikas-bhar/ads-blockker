package org.shieldad.dns

/** Small synchronized LRU. Cached IDs are replaced before answers are reused. */
class DnsResponseCache(
    private val capacity: Int = 512,
    private val ttlMillis: Long = 60_000,
    private val clock: () -> Long = System::currentTimeMillis
) {
    private data class Entry(val payload: ByteArray, val expiresAt: Long)
    private val entries = object : LinkedHashMap<String, Entry>(capacity, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Entry>) = size > capacity
    }

    @Synchronized
    fun get(key: String, transactionId: Int): ByteArray? {
        val entry = entries[key] ?: return null
        if (entry.expiresAt <= clock()) {
            entries.remove(key)
            return null
        }
        return DnsPacket.withTransactionId(entry.payload, transactionId)
    }

    @Synchronized
    fun put(key: String, payload: ByteArray) {
        entries[key] = Entry(payload.clone(), clock() + ttlMillis)
    }
}
