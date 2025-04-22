import { mathAgent, mathAgentCard } from "./math_agent";
import { A2AServer } from "a2a-sdk-ryukez";

const server = new A2AServer(mathAgent, {
  card: mathAgentCard,
});

server.start(); // Default port 41241

console.log("[MathAgent] Server started on http://localhost:41241");
console.log("[MathAgent] Press Ctrl+C to stop the server");
