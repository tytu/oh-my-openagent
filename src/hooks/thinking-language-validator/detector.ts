export function detectEnglishViolation(text: string, threshold = 0.6): false | 'trigger' | 'ascii' {
  let stripped = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[A-Za-z]:[\\/]\S+|[./~]\S+\/\S+/g, "")
  stripped = stripped.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")

  const englishTriggers = [
    "let me", "i need", "first,", "i'll", "i can", "i should",
    "the user", "we need", "let's", "my task", "i'm going",
    "now,", "now i", "now we", "next,", "next i", "then,", "finally,",
  ]
  const lowerText = stripped.toLowerCase().trim()
  if (lowerText.length > 0) {
    for (const trigger of englishTriggers) {
      if (lowerText.startsWith(trigger)) return 'trigger'
    }
  }

  const meaningful = stripped.replace(/[\s\d\p{P}]/gu, "")
  if (meaningful.length < 4) return false
  const asciiLetters = (meaningful.match(/[a-zA-Z]/g) || []).length
  return asciiLetters / meaningful.length > threshold ? 'ascii' : false
}
