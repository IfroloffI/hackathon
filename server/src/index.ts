import { defineRoom, defineServer } from 'colyseus';
import { CREW_ROOM } from '@chronolet/shared';
import { config } from './config.ts';
import { CrewRoom } from './rooms/CrewRoom.ts';
import { mountHttp } from './http/api.ts';
import { AgentService } from './agents/agentService.ts';
import { lanAddresses } from './core/network.ts';
import './db/db.ts';

const server = defineServer({
  rooms: {
    [CREW_ROOM]: defineRoom(CrewRoom),
  },
  express: (app) => mountHttp(app),
  greet: false,
});

new AgentService().start();

await server.listen(config.port, config.host);
// host 0.0.0.0 — «слушать все интерфейсы», по нему не заходят. Печатаем реальные адреса.
const urls = config.host === '0.0.0.0' ? ['localhost', ...lanAddresses()] : [config.host];
console.log(`[chronolet] сервер запущен (слушает ${config.host}:${config.port}), db=${config.dbPath}`);
for (const h of urls) console.log(`  → http://${h}:${config.port}`);
