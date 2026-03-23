// Detect whether text is German or English.
// Uses umlauts and common German function words as indicators.
// Defaults to English if no German signal is found.

export function detectLanguage(text: string): string {
  const germanIndicators =
    /[äöüßÄÖÜ]|(?:^|\s)(ich|und|der|die|das|ist|nicht|ein|eine|haben|werden|sind|kann|meine|gerne|bitte|ja|nein|genau|richtig|klar|alles|auf|ganz|auch|noch|schon|gut|danke|stimmt|passt|verstehe|aber|oder|weil|wenn|dann|möchte|brauche|natürlich|selbstverständlich|wie|lautet|ihre|ihren|ihrem|ihr)(?:\s|$)/i;
  return germanIndicators.test(text) ? 'de' : 'en';
}
