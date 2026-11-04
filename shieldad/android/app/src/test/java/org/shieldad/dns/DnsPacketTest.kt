package org.shieldad.dns

import java.io.ByteArrayOutputStream
import java.net.InetAddress
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DnsPacketTest {
    private fun query(type: Int = 1, domain: String = "ads.example.com"): ByteArray {
        val output = ByteArrayOutputStream()
        output.write(byteArrayOf(0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0))
        domain.split('.').forEach { label ->
            output.write(label.length)
            output.write(label.toByteArray())
        }
        output.write(0)
        output.write(byteArrayOf((type ushr 8).toByte(), type.toByte(), 0, 1))
        return output.toByteArray()
    }

    private fun request(version: Int = 4, type: Int = 1): UdpDnsPacket {
        val source = InetAddress.getByName(if (version == 4) "10.0.0.2" else "fd00::3").address
        val destination = InetAddress.getByName(if (version == 4) "10.111.222.2" else "fd00::2").address
        val packet = DnsPacket.buildIpUdpPacket(version, source, destination, 53000, 53, query(type))
        return DnsPacket.parseIpUdp(packet)!!
    }

    @Test fun `parses IPv4 UDP DNS question`() {
        val request = request()
        val parsed = DnsPacket.parseDnsQuery(request.dnsPayload)!!
        assertEquals(0x1234, parsed.id)
        assertEquals("ads.example.com", parsed.domain)
        assertEquals(DnsPacket.TYPE_A, parsed.type)
        assertEquals(53, request.destinationPort)
        assertEquals(53000, request.sourcePort)
    }

    @Test fun `parses IPv6 UDP DNS question`() {
        val request = request(version = 6, type = 28)
        assertEquals(6, request.ipVersion)
        assertEquals("ads.example.com", DnsPacket.parseDnsQuery(request.dnsPayload)?.domain)
    }

    @Test fun `builds A response with zero address and valid checksums`() {
        val incoming = request()
        val parsed = DnsPacket.parseDnsQuery(incoming.dnsPayload)!!
        val dns = DnsPacket.buildBlockedResponse(parsed)
        assertEquals(0x1234, (dns[0].toInt() and 255) shl 8 or (dns[1].toInt() and 255))
        assertEquals(1, dns[7].toInt())
        assertArrayEquals(byteArrayOf(0, 0, 0, 0), dns.copyOfRange(dns.size - 4, dns.size))
        val responsePacket = DnsPacket.buildIpUdpResponse(incoming, dns)
        val decoded = DnsPacket.parseIpUdp(responsePacket)
        assertNotNull("IP and UDP checksums must validate", decoded)
        assertArrayEquals(dns, decoded!!.dnsPayload)
        assertEquals(53, decoded.sourcePort)
        assertEquals(53000, decoded.destinationPort)
    }

    @Test fun `builds AAAA response with sixteen zero bytes`() {
        val incoming = request(version = 6, type = 28)
        val dns = DnsPacket.buildBlockedResponse(DnsPacket.parseDnsQuery(incoming.dnsPayload)!!)
        assertEquals(16, dns.size - (12 + DnsPacket.parseDnsQuery(incoming.dnsPayload)!!.encodedQuestion.size + 16))
        assertTrue(dns.copyOfRange(dns.size - 16, dns.size).all { it == 0.toByte() })
        assertNotNull(DnsPacket.parseIpUdp(DnsPacket.buildIpUdpResponse(incoming, dns)))
    }

    @Test fun `rejects corrupt IP and UDP checksums`() {
        val source = InetAddress.getByName("10.0.0.2").address
        val destination = InetAddress.getByName("10.111.222.2").address
        val packet = DnsPacket.buildIpUdpPacket(4, source, destination, 53000, 53, query())
        packet[10] = (packet[10].toInt() xor 1).toByte()
        assertNull(DnsPacket.parseIpUdp(packet))

        val udpCorrupt = DnsPacket.buildIpUdpPacket(4, source, destination, 53000, 53, query())
        udpCorrupt[26] = (udpCorrupt[26].toInt() xor 1).toByte()
        assertNull(DnsPacket.parseIpUdp(udpCorrupt))
    }

    @Test fun `replaces transaction id on cached responses`() {
        var now = 1000L
        val cache = DnsResponseCache(capacity = 1, ttlMillis = 50) { now }
        val dns = DnsPacket.buildBlockedResponse(DnsPacket.parseDnsQuery(query())!!)
        cache.put("ads.example.com/1", dns)
        val cached = cache.get("ads.example.com/1", 0x4321)!!
        assertEquals(0x4321, (cached[0].toInt() and 255) shl 8 or (cached[1].toInt() and 255))
        now += 51
        assertNull(cache.get("ads.example.com/1", 1))
    }
}
