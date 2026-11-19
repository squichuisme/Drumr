import JSZip from 'jszip'

/**
 * Turn whatever the user picked (.musicxml, .xml or compressed .mxl) into a
 * plain MusicXML string. Both OSMD (for drawing) and our own parser (for
 * timing) then read the exact same text, so they can never disagree about
 * which file is loaded.
 */
export async function loadScoreFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return bytesToMusicXml(bytes)
}

/** Exposed separately from loadScoreFile so tests can call it with raw bytes. */
export async function bytesToMusicXml(bytes: Uint8Array): Promise<string> {
  const xml = isZip(bytes) ? await unzipMxl(bytes) : decodeText(bytes)
  assertMusicXml(xml)
  return xml
}

/** Zip files (and therefore .mxl files) always start with the bytes "PK". */
function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

/**
 * A compressed MusicXML (.mxl) file is a zip archive. The file
 * META-INF/container.xml names the actual score inside it ("rootfile").
 */
async function unzipMxl(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)

  const container = zip.file('META-INF/container.xml')
  if (container) {
    const containerXml = await container.async('string')
    const doc = new DOMParser().parseFromString(containerXml, 'application/xml')
    const rootPath = doc.querySelector('rootfile')?.getAttribute('full-path')
    const root = rootPath ? zip.file(rootPath) : null
    if (root) return decodeText(await root.async('uint8array'))
  }

  // No (usable) container.xml: fall back to the first XML file in the archive.
  const candidate = Object.values(zip.files).find(
    (f) => !f.dir && !f.name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(f.name),
  )
  if (!candidate) throw new Error('This .mxl file does not contain a MusicXML score.')
  return decodeText(await candidate.async('uint8array'))
}

/** Decode text, honouring a UTF-16 byte-order mark if there is one (some Finale exports use UTF-16). */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  return new TextDecoder('utf-8').decode(bytes)
}

function assertMusicXml(xml: string): void {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('This file is not valid XML.')
  }
  const root = doc.documentElement.nodeName
  if (root === 'score-timewise') {
    throw new Error('Timewise MusicXML is not supported. Please export as partwise MusicXML (the default in MuseScore).')
  }
  if (root !== 'score-partwise') {
    throw new Error(`This doesn't look like a MusicXML score (root element is <${root}>).`)
  }
}
