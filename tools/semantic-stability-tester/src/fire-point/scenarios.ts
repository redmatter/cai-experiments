// Test scenarios for the fire-point detector.
// Each scenario has an assistant turn + user response.
// We test where the detector fires and whether it's safe.

import type { FirePointScenario } from './types';

export const FIRE_POINT_SCENARIOS: FirePointScenario[] = [

  // =====================================================
  // YES/NO QUESTIONS — should fire early on yes/no
  // =====================================================
  {
    id: 'yn-001',
    language: 'en',
    domain: 'booking',
    assistantTurn: 'Would you like me to book that for you?',
    userUtterance: 'Yes please go ahead',
    expectedFirePoints: [
      { wordsHeard: 'Yes', shouldFire: true, reason: 'Affirmative answers yes/no' },
    ],
    description: 'Simple yes to booking confirmation',
  },
  {
    id: 'yn-002',
    language: 'en',
    domain: 'booking',
    assistantTurn: 'Would you like me to book that for you?',
    userUtterance: "Yes please but can you make it for three o'clock instead",
    expectedFirePoints: [
      { wordsHeard: 'Yes', shouldFire: true, reason: 'Affirmative — but qualification follows' },
    ],
    description: 'Yes with qualification — fire on yes is premature',
  },
  {
    id: 'yn-003',
    language: 'en',
    domain: 'support',
    assistantTurn: 'Do you have your account number handy?',
    userUtterance: 'No I left it at home sorry',
    expectedFirePoints: [
      { wordsHeard: 'No', shouldFire: true, reason: 'Negative answers yes/no' },
    ],
    description: 'Simple no response',
  },
  {
    id: 'yn-004',
    language: 'en',
    domain: 'general',
    assistantTurn: 'Is there anything else I can help you with?',
    userUtterance: "No that's everything thank you",
    expectedFirePoints: [
      { wordsHeard: 'No', shouldFire: true, reason: 'No + elaboration is same meaning' },
    ],
    description: 'No with gratitude filler',
  },
  {
    id: 'yn-005',
    language: 'en',
    domain: 'general',
    assistantTurn: 'Is there anything else I can help you with?',
    userUtterance: 'Yes actually I also need to change my address',
    expectedFirePoints: [
      { wordsHeard: 'Yes', shouldFire: false, reason: 'Yes to open-ended needs more content' },
    ],
    description: 'Yes but to anything-else question — new topic follows',
  },
  {
    id: 'yn-006',
    language: 'en',
    domain: 'sales',
    assistantTurn: 'Shall I add the insurance package?',
    userUtterance: 'Sure why not',
    expectedFirePoints: [
      { wordsHeard: 'Sure', shouldFire: true, reason: 'Affirmative answers yes/no' },
    ],
    description: 'Casual affirmative',
  },
  {
    id: 'yn-007',
    language: 'en',
    domain: 'support',
    assistantTurn: 'Are you still experiencing the issue?',
    userUtterance: "No it's working now actually since I restarted it",
    expectedFirePoints: [
      { wordsHeard: 'No', shouldFire: true, reason: 'Negative — rest is elaboration' },
    ],
    description: 'No with explanation',
  },

  // =====================================================
  // WH-QUESTIONS — should wait for the entity/answer
  // =====================================================
  {
    id: 'wh-001',
    language: 'en',
    domain: 'booking',
    assistantTurn: 'What city would you like to travel to?',
    userUtterance: "I'd like to go to Berlin please",
    expectedFirePoints: [
      { wordsHeard: "I'd like to", shouldFire: false, reason: 'City not yet provided' },
      { wordsHeard: "I'd like to go to Berlin", shouldFire: true, reason: 'City provided' },
    ],
    description: 'City entity needed',
  },
  {
    id: 'wh-002',
    language: 'en',
    domain: 'booking',
    assistantTurn: 'What date would you like to check in?',
    userUtterance: 'Next Friday if possible',
    expectedFirePoints: [
      { wordsHeard: 'Next Friday', shouldFire: true, reason: 'Date provided' },
    ],
    description: 'Date entity needed',
  },
  {
    id: 'wh-003',
    language: 'en',
    domain: 'support',
    assistantTurn: 'What seems to be the problem?',
    userUtterance: "My internet has been really slow for the last two days",
    expectedFirePoints: [
      { wordsHeard: 'My internet', shouldFire: false, reason: 'Incomplete problem description' },
      { wordsHeard: 'My internet has been really slow', shouldFire: true, reason: 'Problem described' },
    ],
    description: 'Problem description needed',
  },
  {
    id: 'wh-004',
    language: 'en',
    domain: 'billing',
    assistantTurn: 'What is your account number?',
    userUtterance: "It's 4-5-7-2-9-8-1",
    expectedFirePoints: [
      { wordsHeard: "It's", shouldFire: false, reason: 'Number not yet provided' },
      { wordsHeard: "It's 4-5-7-2-9-8-1", shouldFire: true, reason: 'Number provided' },
    ],
    description: 'Account number needed',
  },
  {
    id: 'wh-005',
    language: 'en',
    domain: 'booking',
    assistantTurn: 'How many people will be dining?',
    userUtterance: 'There will be four of us',
    expectedFirePoints: [
      { wordsHeard: 'There will be four', shouldFire: true, reason: 'Number provided' },
    ],
    description: 'Party size needed',
  },

  // =====================================================
  // CONFIRMATION — should fire on yes, wait on no
  // =====================================================
  {
    id: 'conf-001',
    language: 'en',
    domain: 'booking',
    assistantTurn: "So that's 3 nights at the Hilton starting Friday, is that correct?",
    userUtterance: 'Yes that sounds right',
    expectedFirePoints: [
      { wordsHeard: 'Yes', shouldFire: true, reason: 'Confirmation affirmed' },
    ],
    description: 'Simple confirmation affirmed',
  },
  {
    id: 'conf-002',
    language: 'en',
    domain: 'booking',
    assistantTurn: "So that's 3 nights at the Hilton starting Friday, is that correct?",
    userUtterance: "No it should be Saturday not Friday",
    expectedFirePoints: [
      { wordsHeard: 'No', shouldFire: false, reason: 'Rejection — correction follows' },
    ],
    description: 'Confirmation rejected — must wait for correction',
  },
  {
    id: 'conf-003',
    language: 'en',
    domain: 'booking',
    assistantTurn: "Just to confirm, you'd like the standard room for two nights?",
    userUtterance: "That's correct yes please book it",
    expectedFirePoints: [
      { wordsHeard: "That's correct", shouldFire: true, reason: 'Confirmed' },
    ],
    description: 'Affirmative phrase confirms',
  },

  // =====================================================
  // OPEN-ENDED — should wait for substantial content
  // =====================================================
  {
    id: 'open-001',
    language: 'en',
    domain: 'general',
    assistantTurn: 'How can I help you today?',
    userUtterance: "I need to cancel my subscription please",
    expectedFirePoints: [
      { wordsHeard: 'I need', shouldFire: false, reason: 'Intent not clear yet' },
      { wordsHeard: 'I need to cancel my subscription', shouldFire: true, reason: 'Intent + object clear' },
    ],
    description: 'Cancellation request to open question',
  },
  {
    id: 'open-002',
    language: 'en',
    domain: 'general',
    assistantTurn: 'How can I help you today?',
    userUtterance: "I'm having trouble with my broadband it keeps dropping out",
    expectedFirePoints: [
      { wordsHeard: "I'm having", shouldFire: false, reason: 'Too vague' },
      { wordsHeard: "I'm having trouble with my broadband", shouldFire: true, reason: 'Problem + subject clear' },
    ],
    description: 'Technical issue to open question',
  },
  {
    id: 'open-003',
    language: 'en',
    domain: 'general',
    assistantTurn: 'How can I help you today?',
    userUtterance: 'Yes hi I was wondering if you could help me change my address',
    expectedFirePoints: [
      { wordsHeard: 'Yes hi', shouldFire: false, reason: 'Greeting filler' },
      { wordsHeard: 'Yes hi I was wondering if you could help me change my address', shouldFire: true, reason: 'Full request' },
    ],
    description: 'Polite request with preamble',
  },

  // =====================================================
  // INFORMATION / ACTION COMPLETE — fire on ack
  // =====================================================
  {
    id: 'info-001',
    language: 'en',
    domain: 'billing',
    assistantTurn: 'Your current balance is forty-two pounds and fifty pence.',
    userUtterance: 'OK thank you',
    expectedFirePoints: [
      { wordsHeard: 'OK', shouldFire: true, reason: 'Acknowledged information' },
    ],
    description: 'Simple acknowledgement of information',
  },
  {
    id: 'info-002',
    language: 'en',
    domain: 'billing',
    assistantTurn: 'Your current balance is forty-two pounds and fifty pence.',
    userUtterance: "That can't be right I paid last week",
    expectedFirePoints: [
      { wordsHeard: "That can't be right", shouldFire: false, reason: 'Dispute — needs full complaint' },
      { wordsHeard: "That can't be right I paid last week", shouldFire: true, reason: 'Full dispute with reason' },
    ],
    description: 'Dispute of information — needs context',
  },
  {
    id: 'info-003',
    language: 'en',
    domain: 'booking',
    assistantTurn: "I've booked that for you. Your reference number is ABC123.",
    userUtterance: 'Perfect thank you very much',
    expectedFirePoints: [
      { wordsHeard: 'Perfect', shouldFire: true, reason: 'Action acknowledged' },
    ],
    description: 'Acknowledgement of completed action',
  },
  {
    id: 'info-004',
    language: 'en',
    domain: 'booking',
    assistantTurn: "I've booked that for you. Your reference number is ABC123.",
    userUtterance: 'Great and can you also book me a taxi to get there',
    expectedFirePoints: [
      { wordsHeard: 'Great', shouldFire: true, reason: 'Ack — but topic shift follows' },
    ],
    description: 'Ack then new request — fire on ack is premature',
  },

  // =====================================================
  // CHOICE QUESTIONS
  // =====================================================
  {
    id: 'choice-001',
    language: 'en',
    domain: 'sales',
    assistantTurn: 'Would you prefer the standard or premium package?',
    userUtterance: 'The premium one please',
    expectedFirePoints: [
      { wordsHeard: 'The premium', shouldFire: true, reason: 'Choice made' },
    ],
    description: 'Clear choice selection',
  },
  {
    id: 'choice-002',
    language: 'en',
    domain: 'sales',
    assistantTurn: 'Would you prefer the standard or premium package?',
    userUtterance: "What's the difference in price between them",
    expectedFirePoints: [
      { wordsHeard: "What's the difference in price", shouldFire: true, reason: 'Counter-question' },
    ],
    description: 'Answering choice with a question',
  },

  // =====================================================
  // CODE PATTERN — fire when structured code is complete
  // =====================================================
  {
    id: 'code-001',
    language: 'en',
    domain: 'billing',
    assistantTurn: 'What is your account number?',
    userUtterance: "It's four five seven two nine eight one",
    expectedFirePoints: [
      { wordsHeard: "It's four five seven two", shouldFire: false, reason: 'Only 4 digits — account needs 7+' },
      { wordsHeard: "It's four five seven two nine eight one", shouldFire: true, reason: '7 digits fills account number pattern' },
    ],
    description: 'Account number spoken as word-numbers',
  },
  {
    id: 'code-002',
    language: 'en',
    domain: 'billing',
    assistantTurn: 'What is your account number?',
    userUtterance: 'Yeah it is 4 5 7 2 9 8 1',
    expectedFirePoints: [
      { wordsHeard: 'Yeah it is 4 5 7 2', shouldFire: false, reason: 'Only 4 digits' },
      { wordsHeard: 'Yeah it is 4 5 7 2 9 8 1', shouldFire: true, reason: '7 digits' },
    ],
    description: 'Account number as bare digits',
  },
  {
    id: 'code-003',
    language: 'en',
    domain: 'billing',
    assistantTurn: 'Could you tell me your sort code?',
    userUtterance: 'Sure its twenty three forty five sixty seven',
    expectedFirePoints: [
      { wordsHeard: 'Sure its twenty three forty five', shouldFire: false, reason: 'Only 4 digits so far' },
      { wordsHeard: 'Sure its twenty three forty five sixty seven', shouldFire: true, reason: '6 digits fills sort code pattern' },
    ],
    description: 'Sort code with tens-compound number words',
  },
  {
    id: 'code-004',
    language: 'en',
    domain: 'logistics',
    assistantTurn: 'What is your postcode?',
    userUtterance: 'S W one A one A A',
    expectedFirePoints: [
      { wordsHeard: 'S W one', shouldFire: false, reason: 'Incomplete postcode' },
      { wordsHeard: 'S W one A one A A', shouldFire: true, reason: 'UK postcode pattern filled' },
    ],
    description: 'UK postcode spelled out letter-by-letter',
  },
  {
    id: 'code-005',
    language: 'en',
    domain: 'support',
    assistantTurn: 'Can you give me the last four digits of your card?',
    userUtterance: "Yeah it's double four nine one",
    expectedFirePoints: [
      { wordsHeard: "Yeah it's double four", shouldFire: false, reason: 'Only 2 digits (44)' },
      { wordsHeard: "Yeah it's double four nine one", shouldFire: true, reason: '4 digits (4491)' },
    ],
    description: 'Card digits with "double" modifier',
  },
  {
    id: 'code-006',
    language: 'en',
    domain: 'support',
    assistantTurn: 'What is your reference number?',
    userUtterance: 'Alpha Bravo Charlie one two three four',
    expectedFirePoints: [
      { wordsHeard: 'Alpha Bravo', shouldFire: false, reason: 'Too short for reference' },
      { wordsHeard: 'Alpha Bravo Charlie one two three four', shouldFire: true, reason: '7-char reference code (ABC1234)' },
    ],
    description: 'Reference code using NATO alphabet + numbers',
  },
  {
    id: 'code-007',
    language: 'en',
    domain: 'billing',
    assistantTurn: 'What is your phone number?',
    userUtterance: 'Oh seven seven double oh one two three four five six',
    expectedFirePoints: [
      { wordsHeard: 'Oh seven seven double oh one two three', shouldFire: false, reason: 'Only 9 digits' },
      { wordsHeard: 'Oh seven seven double oh one two three four five six', shouldFire: true, reason: '11 digits fills UK phone pattern' },
    ],
    description: 'UK mobile number with oh and double',
  },
  {
    id: 'code-008',
    language: 'de',
    domain: 'billing',
    assistantTurn: 'Wie lautet Ihre Kontonummer?',
    userUtterance: 'Die ist eins zwei drei vier fünf sechs sieben acht',
    expectedFirePoints: [
      { wordsHeard: 'Die ist eins zwei drei', shouldFire: false, reason: 'Only 3 digits' },
      { wordsHeard: 'Die ist eins zwei drei vier fünf sechs sieben acht', shouldFire: true, reason: '8 digits fills account pattern' },
    ],
    description: 'German account number as word-numbers',
  },
  {
    id: 'code-009',
    language: 'de',
    domain: 'logistics',
    assistantTurn: 'Wie lautet Ihre Postleitzahl?',
    userUtterance: 'Eins null null eins fünf',
    expectedFirePoints: [
      { wordsHeard: 'Eins null null', shouldFire: false, reason: 'Only 3 digits — PLZ needs 5' },
      { wordsHeard: 'Eins null null eins fünf', shouldFire: true, reason: '5 digits fills PLZ pattern' },
    ],
    description: 'German PLZ (postcode) as word-numbers',
  },

  // =====================================================
  // GERMAN SCENARIOS
  // =====================================================
  {
    id: 'de-yn-001',
    language: 'de',
    domain: 'booking',
    assistantTurn: 'Möchten Sie das buchen?',
    userUtterance: 'Ja bitte gerne',
    expectedFirePoints: [
      { wordsHeard: 'Ja', shouldFire: true, reason: 'Affirmative' },
    ],
    description: 'German yes/no affirmative',
  },
  {
    id: 'de-yn-002',
    language: 'de',
    domain: 'booking',
    assistantTurn: 'Möchten Sie das buchen?',
    userUtterance: 'Ja aber bitte erst nächste Woche',
    expectedFirePoints: [
      { wordsHeard: 'Ja', shouldFire: true, reason: 'Affirmative — but qualification follows' },
    ],
    description: 'German yes with qualification',
  },
  {
    id: 'de-wh-001',
    language: 'de',
    domain: 'booking',
    assistantTurn: 'In welche Stadt möchten Sie reisen?',
    userUtterance: 'Ich möchte gerne nach Berlin fliegen',
    expectedFirePoints: [
      { wordsHeard: 'Ich möchte', shouldFire: false, reason: 'City not yet provided' },
      { wordsHeard: 'Ich möchte gerne nach Berlin', shouldFire: true, reason: 'City provided' },
    ],
    description: 'German wh-question — city needed',
  },
  {
    id: 'de-open-001',
    language: 'de',
    domain: 'general',
    assistantTurn: 'Wie kann ich Ihnen helfen?',
    userUtterance: 'Ich möchte mein Abonnement kündigen bitte',
    expectedFirePoints: [
      { wordsHeard: 'Ich möchte', shouldFire: false, reason: 'Intent unclear' },
      { wordsHeard: 'Ich möchte mein Abonnement kündigen', shouldFire: true, reason: 'Intent + object clear' },
    ],
    description: 'German open-ended cancellation',
  },
  {
    id: 'de-conf-001',
    language: 'de',
    domain: 'booking',
    assistantTurn: 'Also 3 Nächte im Hilton ab Freitag, stimmt das?',
    userUtterance: 'Ja genau das stimmt',
    expectedFirePoints: [
      { wordsHeard: 'Ja', shouldFire: true, reason: 'Confirmation affirmed' },
    ],
    description: 'German confirmation affirmed',
  },
  {
    id: 'de-conf-002',
    language: 'de',
    domain: 'booking',
    assistantTurn: 'Also 3 Nächte im Hilton ab Freitag, stimmt das?',
    userUtterance: 'Nein es sollte Samstag sein nicht Freitag',
    expectedFirePoints: [
      { wordsHeard: 'Nein', shouldFire: false, reason: 'Rejection — correction follows' },
    ],
    description: 'German confirmation rejected',
  },
];
