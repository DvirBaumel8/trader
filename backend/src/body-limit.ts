/**
 * A 300-node knowledge graph is about 500 KB of JSON, well past express's
 * 100 KB default. Shared by main.ts and the e2e specs so both accept it.
 */
export const JSON_BODY_LIMIT = '2mb';
