package org.shieldad.dns

data class UdpDnsPacket(
    val ipVersion: Int,
    val sourceAddress: ByteArray,
    val destinationAddress: ByteArray,
    val sourcePort: Int,
    val destinationPort: Int,
    val dnsPayload: ByteArray
)

data class DnsQuery(
    val id: Int,
    val flags: Int,
    val domain: String,
    val type: Int,
    val queryClass: Int,
    val encodedQuestion: ByteArray,
    val raw: ByteArray
)

object DnsPacket {
    const val TYPE_A = 1
    const val TYPE_AAAA = 28

    private fun u8(value: Int) = value and 0xff
    private fun u16(data: ByteArray, offset: Int) = (u8(data[offset].toInt()) shl 8) or u8(data[offset + 1].toInt())
    private fun put16(data: ByteArray, offset: Int, value: Int) {
        data[offset] = (value ushr 8).toByte()
        data[offset + 1] = value.toByte()
    }
    private fun put32(data: ByteArray, offset: Int, value: Int) {
        data[offset] = (value ushr 24).toByte()
        data[offset + 1] = (value ushr 16).toByte()
        data[offset + 2] = (value ushr 8).toByte()
        data[offset + 3] = value.toByte()
    }

    private fun sumWords(data: ByteArray, offset: Int = 0, length: Int = data.size, initial: Long = 0): Long {
        var sum = initial
        var index = offset
        val end = offset + length
        while (index + 1 < end) {
            sum += ((u8(data[index].toInt()) shl 8) or u8(data[index + 1].toInt())).toLong()
            index += 2
        }
        if (index < end) sum += (u8(data[index].toInt()) shl 8).toLong()
        return sum
    }

    private fun folded(sum: Long): Int {
        var value = sum
        while ((value ushr 16) != 0L) value = (value and 0xffff) + (value ushr 16)
        return value.toInt() and 0xffff
    }

    fun internetChecksum(data: ByteArray, offset: Int = 0, length: Int = data.size): Int =
        folded(sumWords(data, offset, length)).inv() and 0xffff

    fun udpChecksum(source: ByteArray, destination: ByteArray, udp: ByteArray): Int {
        require(source.size == destination.size && (source.size == 4 || source.size == 16))
        var sum = sumWords(source) + sumWords(destination)
        if (source.size == 16) {
            sum += (udp.size ushr 16).toLong()
            sum += (udp.size and 0xffff).toLong()
            sum += 17L
        } else {
            sum += 17L
            sum += (udp.size and 0xffff).toLong()
        }
        sum = sumWords(udp, initial = sum)
        return folded(sum).inv() and 0xffff
    }

    fun parseDnsQuery(payload: ByteArray): DnsQuery? {
        if (payload.size < 17 || u16(payload, 4) != 1) return null
        val labels = mutableListOf<String>()
        var offset = 12
        var wireLength = 0
        while (offset < payload.size) {
            val length = u8(payload[offset++].toInt())
            if (length == 0) break
            if (length > 63 || offset + length > payload.size || wireLength + length + 1 > 253) return null
            val label = String(payload, offset, length, Charsets.UTF_8)
            if (label.isEmpty() || label.any { it == '.' || it.code < 33 }) return null
            labels += label
            wireLength += length + 1
            offset += length
        }
        if (labels.isEmpty() || offset + 4 > payload.size) return null
        val type = u16(payload, offset)
        val queryClass = u16(payload, offset + 2)
        offset += 4
        return DnsQuery(
            id = u16(payload, 0),
            flags = u16(payload, 2),
            domain = labels.joinToString(".").lowercase(),
            type = type,
            queryClass = queryClass,
            encodedQuestion = payload.copyOfRange(12, offset),
            raw = payload
        )
    }

    fun buildBlockedResponse(query: DnsQuery): ByteArray {
        require(query.type == TYPE_A || query.type == TYPE_AAAA) { "Only A and AAAA queries have null-address responses" }
        val addressLength = if (query.type == TYPE_A) 4 else 16
        val output = ByteArray(12 + query.encodedQuestion.size + 16 + addressLength)
        put16(output, 0, query.id)
        // QR + RA, preserving RD and CD. RCODE is NOERROR.
        put16(output, 2, 0x8080 or (query.flags and 0x0110))
        put16(output, 4, 1)
        put16(output, 6, 1)
        query.encodedQuestion.copyInto(output, 12)
        var offset = 12 + query.encodedQuestion.size
        put16(output, offset, 0xc00c); offset += 2
        put16(output, offset, query.type); offset += 2
        put16(output, offset, query.queryClass); offset += 2
        put32(output, offset, 60); offset += 4
        put16(output, offset, addressLength); offset += 2
        // The answer's RDATA is already zeroed: 0.0.0.0 or ::.
        return output
    }

    fun buildEmptyResponse(query: DnsQuery, responseCode: Int = 0): ByteArray {
        val output = ByteArray(12 + query.encodedQuestion.size)
        put16(output, 0, query.id)
        put16(output, 2, 0x8080 or (query.flags and 0x0110) or (responseCode and 0x0f))
        put16(output, 4, 1)
        query.encodedQuestion.copyInto(output, 12)
        return output
    }

    fun withTransactionId(response: ByteArray, id: Int): ByteArray {
        require(response.size >= 2)
        return response.clone().also { put16(it, 0, id) }
    }

    fun parseIpUdp(packet: ByteArray, length: Int = packet.size): UdpDnsPacket? {
        if (length < 28 || length > packet.size) return null
        return when (u8(packet[0].toInt()) ushr 4) {
            4 -> parseIpv4(packet, length)
            6 -> parseIpv6(packet, length)
            else -> null
        }
    }

    private fun parseIpv4(packet: ByteArray, length: Int): UdpDnsPacket? {
        val headerLength = (packet[0].toInt() and 0x0f) * 4
        if (headerLength < 20 || length < headerLength + 8 || packet[9].toInt() != 17) return null
        val totalLength = u16(packet, 2)
        if (totalLength < headerLength + 8 || totalLength > length || (u16(packet, 6) and 0x3fff) != 0) return null
        if (internetChecksum(packet, 0, headerLength) != 0) return null
        val source = packet.copyOfRange(12, 16)
        val destination = packet.copyOfRange(16, 20)
        val udpLength = u16(packet, headerLength + 4)
        if (udpLength < 8 || headerLength + udpLength > totalLength) return null
        val udp = packet.copyOfRange(headerLength, headerLength + udpLength)
        val checksum = u16(udp, 6)
        if (checksum != 0 && udpChecksum(source, destination, udp) != 0) return null
        return UdpDnsPacket(4, source, destination, u16(udp, 0), u16(udp, 2), udp.copyOfRange(8, udp.size))
    }

    private fun parseIpv6(packet: ByteArray, length: Int): UdpDnsPacket? {
        if (length < 48 || packet[6].toInt() != 17) return null
        val payloadLength = u16(packet, 4)
        if (payloadLength < 8 || 40 + payloadLength > length) return null
        val source = packet.copyOfRange(8, 24)
        val destination = packet.copyOfRange(24, 40)
        val udp = packet.copyOfRange(40, 40 + payloadLength)
        if (u16(udp, 4) != payloadLength || u16(udp, 6) == 0 || udpChecksum(source, destination, udp) != 0) return null
        return UdpDnsPacket(6, source, destination, u16(udp, 0), u16(udp, 2), udp.copyOfRange(8, udp.size))
    }

    fun buildIpUdpPacket(
        ipVersion: Int,
        source: ByteArray,
        destination: ByteArray,
        sourcePort: Int,
        destinationPort: Int,
        payload: ByteArray
    ): ByteArray {
        require(sourcePort in 1..65535 && destinationPort in 1..65535)
        val udpLength = 8 + payload.size
        require(udpLength <= 65535)
        return if (ipVersion == 4) {
            require(source.size == 4 && destination.size == 4)
            val packet = ByteArray(20 + udpLength)
            packet[0] = 0x45
            put16(packet, 2, packet.size)
            put16(packet, 6, 0x4000)
            packet[8] = 64
            packet[9] = 17
            source.copyInto(packet, 12); destination.copyInto(packet, 16)
            put16(packet, 10, internetChecksum(packet, 0, 20))
            buildUdp(packet, 20, source, destination, sourcePort, destinationPort, payload)
            packet
        } else {
            require(ipVersion == 6 && source.size == 16 && destination.size == 16 && udpLength <= 65535)
            val packet = ByteArray(40 + udpLength)
            packet[0] = 0x60
            put16(packet, 4, udpLength)
            packet[6] = 17
            packet[7] = 64
            source.copyInto(packet, 8); destination.copyInto(packet, 24)
            buildUdp(packet, 40, source, destination, sourcePort, destinationPort, payload)
            packet
        }
    }

    private fun buildUdp(packet: ByteArray, offset: Int, source: ByteArray, destination: ByteArray, sourcePort: Int, destinationPort: Int, payload: ByteArray) {
        val udpLength = 8 + payload.size
        put16(packet, offset, sourcePort)
        put16(packet, offset + 2, destinationPort)
        put16(packet, offset + 4, udpLength)
        payload.copyInto(packet, offset + 8)
        val udp = packet.copyOfRange(offset, offset + udpLength)
        val checksum = udpChecksum(source, destination, udp)
        // A computed zero is transmitted as all ones; zero itself means "no checksum" in IPv4.
        put16(packet, offset + 6, if (checksum == 0) 0xffff else checksum)
    }

    fun buildIpUdpResponse(request: UdpDnsPacket, dnsResponse: ByteArray): ByteArray = buildIpUdpPacket(
        request.ipVersion,
        request.destinationAddress,
        request.sourceAddress,
        request.destinationPort,
        request.sourcePort,
        dnsResponse
    )
}
