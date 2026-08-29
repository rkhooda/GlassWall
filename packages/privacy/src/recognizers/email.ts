import { Recognizer, Span, getTier } from './types';
import { incrementConstructionCount } from './types';

const COMMON_TLDS = 'com|org|net|edu|gov|mil|int|io|co|ai|app|dev|me|us|uk|ca|au|de|fr|jp|in|br|mx|nl|se|no|fi|dk|ch|at|be|ie|pt|es|it|pl|cz|hu|ro|bg|hr|sk|si|lt|lv|ee|lu|mt|cy|is|li|mc|sm|va|ad|fo|gl|pm|tf|gf|mq|gp|re|yt|bl|mf|sx|bq|cw|aw|ai|vg|ky|tc|bm|fk|gs|sh|pn|nr|tv|fm|mh|pw|ki|to|ws|nu|cc|tk|eu|cat|asia|tel|xxx|jobs|mobi|pro|name|aero|coop|museum|travel|post|geo|arpa|example|test|localhost|invalid|local|internal|onion|bit|eth|luxe|zil|crypto|nft|dao|web3|metaverse';

const EMAIL_REGEX = new RegExp(
  '\\b[a-zA-Z0-9.!#$%&\'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\\.(?:' + COMMON_TLDS + ')\\b',
  'g'
);

incrementConstructionCount();

export const emailRecognizer: Recognizer = {
  type: 'EMAIL',
  tier: getTier('EMAIL'),
  detect(text: string): Span[] {
    const spans: Span[] = [];
    let match: RegExpExecArray | null;
    while ((match = EMAIL_REGEX.exec(text)) !== null) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;
      spans.push({
        start, end, value, type: 'EMAIL', tier: getTier('EMAIL'), confidence: 0.95, rule_id: 'email-regex-v1',
      });
    }
    return spans;
  },
};