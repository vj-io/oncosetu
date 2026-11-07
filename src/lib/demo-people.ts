// The seeded synthetic people the demo sign-in buttons offer (same list as src/server/demo-login.ts, which is the policy).
// Kept in src/lib so the browser bundle does not import server code.
export const DEMO_PEOPLE = [
  { key: 'rohan', phone: '+91 98230 55102' },
  { key: 'khan', phone: '+91 99870 12345' },
  { key: 'narayanan', phone: '+91 94440 67890' },
  { key: 'pooja', phone: '+91 98500 11223' },
] as const
