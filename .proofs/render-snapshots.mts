import express from 'express';
import { buildPage } from '../src/hub/auth-callback.ts';

const states: Array<{
  path: string;
  title: string;
  message: string;
  status: 'success' | 'error';
  dashboardUrl?: string;
}> = [
  {
    path: '/success',
    title: 'Login successful!',
    message: 'You can close this window and return to the terminal.',
    status: 'success',
    dashboardUrl: 'https://agentage.io/dashboard',
  },
  {
    path: '/missing',
    title: 'Login failed',
    message: 'Missing authentication parameters.',
    status: 'error',
  },
  {
    path: '/decode',
    title: 'Login failed',
    message: 'Failed to decode access token.',
    status: 'error',
  },
];

const app = express();
for (const s of states) {
  app.get(s.path, (_req, res) => {
    res.type('html').send(
      buildPage({ title: s.title, message: s.message, status: s.status, dashboardUrl: s.dashboardUrl })
    );
  });
}

app.listen(9877, () => {
  console.log('cli-callback snapshot server on :9877');
  console.log(states.map((s) => '  http://127.0.0.1:9877' + s.path).join('\n'));
});
