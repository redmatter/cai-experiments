export interface SpeechActClassification {
  speechAct: SpeechAct;
  domain: Domain;
  sentiment: Sentiment;
  tags: string;
}

export type SpeechAct = 'question' | 'complaint' | 'request' | 'confusion' | 'acknowledgement' | 'greeting' | 'statement';
export type Domain = 'sip_voip' | 'call_quality' | 'billing' | 'configuration' | 'provisioning' | 'general';
export type Sentiment = 'frustrated' | 'confused' | 'neutral' | 'positive';

const SPEECH_ACT_PATTERNS: { act: SpeechAct; patterns: RegExp[] }[] = [
  {
    act: 'greeting',
    patterns: [
      /^(hi|hello|hey|good morning|good afternoon|good evening)\b/i,
    ],
  },
  {
    act: 'complaint',
    patterns: [
      /\b(not working|broken|down|keeps? (failing|dropping|crashing)|can't (get|make|use)|doesn'?t work|stopped working|still (broken|down|not)|won'?t (connect|register|work)|been (waiting|trying|down)|keeps happening|happening again|third time|again and again)\b/i,
      /\b(unacceptable|ridiculous|terrible|awful|useless|waste of time)\b/i,
    ],
  },
  {
    act: 'confusion',
    patterns: [
      /\b(confused|don'?t (understand|know|get)|not sure|what does .+ mean|makes? no sense|lost|no idea|unclear)\b/i,
      /\bwhat('?s| is) (going on|happening|the (deal|issue|problem))\b/i,
    ],
  },
  {
    act: 'request',
    patterns: [
      /\b(can you|could you|please|i need you to|would you|i'?d like you to|go ahead and|set up|configure|change|update|reset|transfer|add|remove|enable|disable|create)\b/i,
    ],
  },
  {
    act: 'question',
    patterns: [
      /\?$/,
      /^(how|what|when|where|why|which|who|is it|can i|do you|does|are there|will|would)\b/i,
      /\b(how (do|does|can|would|should|to)|what (is|are|does|should)|tell me about)\b/i,
    ],
  },
  {
    act: 'acknowledgement',
    patterns: [
      /^(ok|okay|sure|right|got it|thanks|thank you|yes|yep|yeah|alright|perfect|great|understood)\b/i,
    ],
  },
];

const DOMAIN_PATTERNS: { domain: Domain; patterns: RegExp[] }[] = [
  {
    domain: 'sip_voip',
    patterns: [
      /\b(sip|voip|trunk|registration|register|codec|rtp|sdp|invite|ack|bye|pbx|extension|dial plan|inbound|outbound|route|routing|did|ddi|ivr)\b/i,
    ],
  },
  {
    domain: 'call_quality',
    patterns: [
      /\b(jitter|latency|packet loss|choppy|echo|delay|garbled|static|audio|sound|voice quality|one[- ]way|no audio|can'?t hear|muffled|robotic|cutting out|drops?|dropping|call quality)\b/i,
    ],
  },
  {
    domain: 'billing',
    patterns: [
      /\b(bill|billing|invoice|pricing|price|cost|charge|subscription|payment|plan|license|per[- ]user|per[- ]seat|credit|refund)\b/i,
    ],
  },
  {
    domain: 'configuration',
    patterns: [
      /\b(config|configuration|setting|settings|admin|portal|dashboard|setup|integration|api key|webhook|permission|role|user management|salesforce)\b/i,
    ],
  },
  {
    domain: 'provisioning',
    patterns: [
      /\b(provision|onboard|new user|new number|port|porting|number|handset|phone|device|deploy|rollout|migrate|migration)\b/i,
    ],
  },
];

const SENTIMENT_PATTERNS: { sentiment: Sentiment; patterns: RegExp[] }[] = [
  {
    sentiment: 'frustrated',
    patterns: [
      /\b(frustrated|annoyed|angry|furious|fed up|sick of|tired of|unacceptable|ridiculous|terrible|awful|worst|nightmare|disaster)\b/i,
      /!{2,}/,
      /\b(still|again|keeps?|always|every time|third time|yet again)\b.*\b(not|broken|failing|down|wrong)\b/i,
      /\b(really|very|so) bad\b/i,
    ],
  },
  {
    sentiment: 'confused',
    patterns: [
      /\b(confused|confusing|don'?t (understand|get)|not sure|unclear|lost|no idea|makes? no sense|what does .+ mean)\b/i,
    ],
  },
  {
    sentiment: 'positive',
    patterns: [
      /\b(thanks|thank you|appreciate|great|perfect|awesome|excellent|wonderful|helpful|love)\b/i,
    ],
  },
];

export function classifySpeechAct(utterance: string): SpeechActClassification {
  const trimmed = utterance.trim();

  // Detect speech act (first match wins — order matters)
  let speechAct: SpeechAct = 'statement';
  for (const { act, patterns } of SPEECH_ACT_PATTERNS) {
    if (patterns.some(p => p.test(trimmed))) {
      speechAct = act;
      break;
    }
  }

  // Detect domain (first match wins)
  let domain: Domain = 'general';
  for (const { domain: d, patterns } of DOMAIN_PATTERNS) {
    if (patterns.some(p => p.test(trimmed))) {
      domain = d;
      break;
    }
  }

  // Detect sentiment (first match wins)
  let sentiment: Sentiment = 'neutral';
  for (const { sentiment: s, patterns } of SENTIMENT_PATTERNS) {
    if (patterns.some(p => p.test(trimmed))) {
      sentiment = s;
      break;
    }
  }

  const tags = `[SPEECH_ACT: ${speechAct}] [DOMAIN: ${domain}] [SENTIMENT: ${sentiment}]`;

  return { speechAct, domain, sentiment, tags };
}
