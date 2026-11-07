// Browser preview uses the same controller and world session as the engine.
import { WorldSession } from '../assets/world/session.ts';
import { mountQingming } from '../assets/ui/controller.ts';
const channel = new MessageChannel();
const world = new WorldSession(m => channel.port2.postMessage(m));
channel.port2.onmessage = e => world.receive(e.data, e.ports[0]);
channel.port2.start();
mountQingming({ uiRoot: document.body, port: channel.port1 });
setInterval(() => world.poll(), 100);
