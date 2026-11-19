import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { bytesToMusicXml } from './loadScoreFile'
import rockBeatXml from '../samples/rock-beat.musicxml?raw'

const encode = (s: string) => new TextEncoder().encode(s)

describe('loading score files', () => {
  it('passes plain MusicXML through', async () => {
    expect(await bytesToMusicXml(encode(rockBeatXml))).toBe(rockBeatXml)
  })

  it('unzips a compressed .mxl using META-INF/container.xml', async () => {
    const zip = new JSZip()
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?><container><rootfiles><rootfile full-path="scores/beat.musicxml"/></rootfiles></container>`,
    )
    zip.file('scores/beat.musicxml', rockBeatXml)
    zip.file('scores/other.xml', '<not-this/>')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    expect(await bytesToMusicXml(bytes)).toBe(rockBeatXml)
  })

  it('falls back to the first XML file when container.xml is missing', async () => {
    const zip = new JSZip()
    zip.file('beat.xml', rockBeatXml)
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    expect(await bytesToMusicXml(bytes)).toBe(rockBeatXml)
  })

  it('decodes UTF-16 files with a byte-order mark', async () => {
    const xml = '<?xml version="1.0" encoding="UTF-16"?><score-partwise></score-partwise>'
    const bytes = new Uint8Array(2 + xml.length * 2)
    bytes[0] = 0xff
    bytes[1] = 0xfe
    for (let i = 0; i < xml.length; i++) bytes[2 + i * 2] = xml.charCodeAt(i)
    expect(await bytesToMusicXml(bytes)).toContain('score-partwise')
  })

  it('rejects files that are not MusicXML', async () => {
    await expect(bytesToMusicXml(encode('<html><body/></html>'))).rejects.toThrow(/MusicXML/)
    await expect(bytesToMusicXml(encode('not xml at all <'))).rejects.toThrow(/valid XML/)
  })
})
