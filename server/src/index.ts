import { defineRoom, defineServer } from 'colyseus';
import { CREW_ROOM } from '@chronolet/shared';
import { config } from './config.ts';
import { CrewRoom } from './rooms/CrewRoom.ts';
import { mountHttp } from './http/api.ts';
import { AgentService } from './agents/agentService.ts';
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
console.log(`[chronolet] http+ws on http://${config.host}:${config.port}  db=${config.dbPath}`);
