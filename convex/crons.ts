import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every 1 minute, check if schedule needs rotation
crons.interval(
  "rotateSchedule",
  { minutes: 1 },
  internal.channel.rotateSchedule,
);

// Every 5 minutes, recover items stuck in "working" state
crons.interval(
  "recoverStuckItems",
  { minutes: 5 },
  internal.channel.recoverStuckItems,
);

export default crons;
