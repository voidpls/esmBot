import packageJson from "../../package.json" assert { type: "json" };
import os from "node:os";
import Command from "../../classes/command.js";
import { VERSION } from "oceanic.js";
const pm2 = process.env.PM2_USAGE ? (await import("pm2")).default : null;
import { getServers } from "../../utils/misc.js";

class StatsCommand extends Command {
  async run() {
    const uptime = process.uptime() * 1000;
    const connUptime = this.client.uptime;
    let owner = this.client.users.get(process.env.OWNER.split(",")[0]);
    if (!owner) owner = await this.client.rest.users.get(process.env.OWNER.split(",")[0]);
    const servers = await getServers(this.client);
    const processMem = `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`;
    return {
      embeds: [{
        author: {
          name: "esmBot Statistics",
          iconURL: this.client.user.avatarURL()
        },
        description: `This instance is managed by **${owner.username}${owner.discriminator === 0 ? `#${owner.discriminator}` : ""}**`,
        color: 16711680,
        fields: [{
          name: "Version",
          value: `v${packageJson.version}${process.env.NODE_ENV === "development" ? `-dev (${process.env.GIT_REV})` : ""}`
        },
        {
          name: "Process Memory Usage",
          value: processMem,
          inline: true
        },
        {
          name: "Total Memory Usage",
          value: process.env.PM2_USAGE ? `${((await this.list()).reduce((prev, cur) => prev + cur.monit.memory, 0) / 1024 / 1024).toFixed(2)} MB` : processMem,
          inline: true
        },
        {
          name: "Bot Uptime",
          value: `${Math.trunc(uptime / 86400000)} days, ${Math.trunc(uptime / 3600000) % 24} hrs, ${Math.trunc(uptime / 60000) % 60} mins, ${Math.trunc(uptime / 1000) % 60} secs`
        },
        {
          name: "Connection Uptime",
          value: `${Math.trunc(connUptime / 86400000)} days, ${Math.trunc(connUptime / 3600000) % 24} hrs, ${Math.trunc(connUptime / 60000) % 60} mins, ${Math.trunc(connUptime / 1000) % 60} secs`
        },
        {
          name: "Host",
          value: `${os.type()} ${os.release()} (${os.arch()})`,
          inline: true
        },
        {
          name: "Library",
          value: `Oceanic ${VERSION}`,
          inline: true
        },
        {
          name: process.versions.bun ? "Bun Version" : "Node.js Version",
          value: process.versions.bun ?? process.versions.node,
          inline: true
        },
        {
          name: "Shard",
          value: this.guild ? this.client.guildShardMap[this.guild.id] : "N/A",
          inline: true
        },
        {
          name: "Servers",
          value: servers ? servers : `${this.client.guilds.size} (for this process only)`,
          inline: true
        }
        ]
      }]
    };
  }

  list() {
    return new Promise((resolve, reject) => {
      pm2.list((err, list) => {
        if (err) return reject(err);
        resolve(list.filter((v) => v.name.includes("esmBot-proc")));
      });
    });
  }

  static description = "Gets some statistics about me";
  static aliases = ["status", "stat"];
}

export default StatsCommand;