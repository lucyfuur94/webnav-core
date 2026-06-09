import { MapStore } from './src/mapstore/store.ts';
import { startServer } from './src/server.ts';
startServer(new MapStore('webnav.db'), 7788); console.log('UP');
