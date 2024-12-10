import Command from "./command.js";
import imageDetect from "../utils/imagedetect.js";
import { runImageJob } from "../utils/image.js";
import { runningCommands } from "../utils/collections.js";
import { clean, isEmpty, random } from "../utils/misc.js";
import { selectedImages } from "../utils/collections.js";
import messages from "../config/messages.json" with { type: "json" };
import { Constants, CommandInteraction } from "oceanic.js";
import { getAllLocalizations } from "../utils/i18n.js";

class ImageCommand extends Command {
  /**
   * @param {string} _text
   * @param {string} _url
   */
  async criteria(_text, _url) {
    return true;
  }

  async run() {
    this.success = false;

    if (!this.permissions.has("ATTACH_FILES")) return this.getString("permissions.noAttachFiles");
    
    const memberChannelPerms = this.channel?.permissionsOf?.(this.author.id)
    if (memberChannelPerms && !memberChannelPerms.has("ATTACH_FILES")) 
      return "You don't have the `Attach Files` permission!";
    
    
    const timestamp = this.type === "application" && this.interaction ? CommandInteraction.getCreatedAt(this.interaction.id) : this.message?.createdAt ?? new Date();
    // check if this command has already been run in this channel with the same arguments, and we are awaiting its result
    // if so, don't re-run it
    if (runningCommands.has(this.author?.id) && (runningCommands.get(this.author?.id).getTime() - timestamp.getTime()) < 5000) {
      return this.getString("image.slowDown");
    }
    // before awaiting the command result, add this command to the set of running commands
    runningCommands.set(this.author.id, timestamp);

    const imageParams = {
      cmd: this.constructor.command,
      params: {
        togif: !!this.options.togif
      },
      id: (this.interaction ?? this.message).id
    };

    let needsSpoiler = false;
    if (this.constructor.requiresImage) {
      try {
        const selection = selectedImages.get(this.author.id);
        const image = selection ?? await imageDetect(this.client, this.message, this.interaction, this.options, true).catch(e => {
          if (e.name === "AbortError") return { type: "timeout" };
          throw e;
        });
        if (selection) selectedImages.delete(this.author.id);
        if (image === undefined) {
          runningCommands.delete(this.author.id);
          return `${this.getString(`commands.noImage.${this.cmdName}`, true) || this.getString("image.noImage", true) || this.constructor.noImage} ${this.getString("image.tip")}`;
        }
        needsSpoiler = image.spoiler;
        if (image.type === "large") {
          runningCommands.delete(this.author.id);
          return this.getString("image.large");
        }
        if (image.type === "tenorlimit") {
          runningCommands.delete(this.author.id);
          return this.getString("image.tenor");
        }
        if (image.type === "timeout") {
          runningCommands.delete(this.author.id);
          return this.getString("image.timeout");
        }
        if (image.type === "badurl") {
          runningCommands.delete(this.author.id);
          return this.getString("image.badurl");
        }
        imageParams.path = image.path;
        imageParams.params.type = image.type;
        imageParams.url = image.url; // technically not required but can be useful for text filtering
        imageParams.name = image.name;
        if (this.constructor.requiresGIF) imageParams.onlyGIF = true;
      } catch (e) {
        runningCommands.delete(this.author.id);
        throw e;
      }
    }

    if ("spoiler" in this.options) needsSpoiler = this.options.spoiler;

    if (this.constructor.requiresText) {
      const text = this.options.text ?? this.args.join(" ").trim();
      if (isEmpty(text) || !await this.criteria(text, imageParams.url)) {
        runningCommands.delete(this.author?.id);
        return this.getString(`commands.noText.${this.cmdName}`, true) || this.getString("image.noText", true) || this.constructor.noText;
      }
    }

    if (typeof this.params === "function") {
      Object.assign(imageParams.params, this.params(imageParams.url, imageParams.name));
    } else if (typeof this.params === "object") {
      Object.assign(imageParams.params, this.params);
    }

    let status;
    if (imageParams.params.type === "image/gif" && this.type === "classic") {
      status = await this.processMessage(this.message.channel ?? await this.client.rest.channels.get(this.message.channelID));
    }

    if (this.interaction) {
      imageParams.ephemeral = this.options.ephemeral;
      imageParams.spoiler = needsSpoiler;
      imageParams.token = this.interaction.token;
    }

    try {
      const result = await runImageJob(imageParams);
      const buffer = result.buffer;
      const type = result.type;
      if (type === "sent") return;
      if (type === "frames") return this.getString("image.frames");
      if (type === "unknown") return this.getString("image.unknown");
      if (type === "noresult") return this.getString("image.noResult");
      if (type === "ratelimit") return this.getString("image.ratelimit");
      if (type === "nocmd") return this.getString("image.nocmd");
      if (type === "nogif" && this.constructor.requiresGIF) return this.getString("image.nogif");
      if (type === "empty") return this.constructor.empty;
      this.success = true;
      if (type === "text") return {
        content: `\`\`\`\n${await clean(buffer.toString("utf8"))}\n\`\`\``,
        flags: this.options.ephemeral ? 64 : undefined
      };
      return {
        contents: buffer,
        name: `${needsSpoiler ? "SPOILER_" : ""}${this.constructor.command}.${type}`,
        flags: this.options.ephemeral ? 64 : undefined
      };
    } catch (e) {
      if (e === "Request ended prematurely due to a closed connection") return this.getString("image.tryAgain");
      if (e === "Job timed out" || e === "Timeout") return this.getString("image.tooLong");
      if (e === "No available servers") return this.getString("image.noServers");
      throw e;
    } finally {
      try {
        if (status) await status.delete();
      } catch {
        // no-op
      }
      runningCommands.delete(this.author?.id);
    }

  }

  processMessage(channel) {
    return channel.createMessage({
      content: `${random(messages.emotes) || "⚙️"} ${this.getString("image.processing")}`
    });
  }

  static init() {
    this.flags = [];
    if (this.requiresText || this.textOptional) {
      this.flags.push({
        name: "text",
        nameLocalizations: getAllLocalizations("image.flagNames.text"),
        type: Constants.ApplicationCommandOptionTypes.STRING,
        description: "The text to put on the image",
        descriptionLocalizations: getAllLocalizations("image.flags.text"),
        maxLength: 4096,
        required: !this.textOptional,
        classic: true
      });
    }
    if (this.requiresImage) {
      this.flags.push({
        name: "image",
        nameLocalizations: getAllLocalizations("image.flagNames.image"),
        type: Constants.ApplicationCommandOptionTypes.ATTACHMENT,
        description: "An image/GIF attachment",
        descriptionLocalizations: getAllLocalizations("image.flags.image"),
      }, {
        name: "link",
        nameLocalizations: getAllLocalizations("image.flagNames.link"),
        type: Constants.ApplicationCommandOptionTypes.STRING,
        description: "An image/GIF URL",
        descriptionLocalizations: getAllLocalizations("image.flags.link"),
      });
    }
    if (!this.alwaysGIF) {
      this.flags.push({
        name: "togif",
        nameLocalizations: getAllLocalizations("image.flagNames.togif"),
        type: Constants.ApplicationCommandOptionTypes.BOOLEAN,
        description: "Force GIF output",
        descriptionLocalizations: getAllLocalizations("image.flags.togif")
      })
    }

    this.flags.push({
      name: "spoiler",
      nameLocalizations: getAllLocalizations("image.flagNames.spoiler"),
      type: Constants.ApplicationCommandOptionTypes.BOOLEAN,
      description: "Attempt to send output as a spoiler",
      descriptionLocalizations: getAllLocalizations("image.flags.spoiler")
    }, {
      name: "ephemeral",
      nameLocalizations: getAllLocalizations("image.flagNames.ephemeral"),
      type: Constants.ApplicationCommandOptionTypes.BOOLEAN,
      description: "Attempt to send output as an ephemeral/temporary response",
      descriptionLocalizations: getAllLocalizations("image.flags.ephemeral")
    });
    return this;
  }

  static allowedFonts = ["futura", "impact", "helvetica", "arial", "roboto", "noto", "times", "comic sans ms", "ubuntu"];

  static requiresImage = true;
  static requiresText = false;
  static textOptional = false;
  static requiresGIF = false;
  static alwaysGIF = false;
  static noImage = "You need to provide an image/GIF!";
  static noText = "You need to provide some text!";
  static empty = "The resulting output was empty!";
  static command = "";
}

export default ImageCommand;
