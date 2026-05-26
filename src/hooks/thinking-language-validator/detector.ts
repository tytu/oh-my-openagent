export function detectEnglishViolation(text: string, threshold = 0.6): boolean {
  let stripped = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[A-Za-z]:[\\/]\S+|[./~]\S+\/\S+/g, "")
  stripped = stripped.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  const meaningful = stripped.replace(/[\s\d\p{P}]/gu, "")
  if (meaningful.length < 20) return false
  const asciiLetters = (meaningful.match(/[a-zA-Z]/g) || []).length
  return asciiLetters / meaningful.length > threshold
}
