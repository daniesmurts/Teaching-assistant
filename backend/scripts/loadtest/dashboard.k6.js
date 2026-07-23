// k6 load test — simulates a "900 teachers log in / browse Monday morning"
// stampede against read-heavy, non-AI endpoints (auth, courses, materials
// lists). This is the scenario most likely to expose the Postgres pool
// (25 conns/worker x 2 workers, see backend/src/db/connection.ts) before
// anything else does.
//
// Requires tokens.json from seedLoadTestTeachers.ts — one JWT per virtual
// user, so we're not funneling everyone through /api/auth/login and tripping
// authLimiter (10 attempts/15min/IP).
//
// Run:
//   BASE_URL=https://staging.ispum.ru k6 run backend/scripts/loadtest/dashboard.k6.js
//
// Tune VUS_TARGET to match how many of the 900 teachers you expect logged in
// concurrently at once (not all 900 at the same second in practice).

import http from 'k6/http'
import { check, sleep } from 'k6'
import { SharedArray } from 'k6/data'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const VUS_TARGET = Number(__ENV.VUS_TARGET || 450)

const tokens = new SharedArray('tokens', function () {
  return JSON.parse(open('./tokens.json'))
})

export const options = {
  scenarios: {
    morning_stampede: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: VUS_TARGET },   // ramp up
        { duration: '3m', target: VUS_TARGET },   // hold
        { duration: '30s', target: 0 },           // ramp down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed:   ['rate<0.01'],   // <1% errors
    http_req_duration: ['p(95)<1500'],  // p95 under 1.5s
  },
}

export default function () {
  // Each VU pins to one seeded teacher for the whole run — mirrors one real
  // logged-in session, and keeps us within a single token's rate-limit budget.
  const teacher = tokens[__VU % tokens.length]
  const headers = { Authorization: `Bearer ${teacher.token}` }

  const meRes = http.get(`${BASE_URL}/api/auth/me`, { headers, tags: { name: 'auth_me' } })
  check(meRes, { 'auth/me 200': (r) => r.status === 200 })

  sleep(Math.random() * 2) // think time — a real dashboard load isn't instant clicks

  const coursesRes = http.get(`${BASE_URL}/api/courses`, { headers, tags: { name: 'courses_list' } })
  check(coursesRes, { 'courses 200': (r) => r.status === 200 })

  const quizzesRes = http.get(`${BASE_URL}/api/quizzes`, { headers, tags: { name: 'quizzes_list' } })
  check(quizzesRes, { 'quizzes 200': (r) => r.status === 200 })

  sleep(1 + Math.random() * 3)
}
