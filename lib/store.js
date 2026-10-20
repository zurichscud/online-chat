'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_MESSAGES_PER_CONVERSATION = 500;

/**
 * Tiny JSON-backed store. The demo keeps everything in a single file so the
 * whole system can run with `npm start` and no external database.
 */
class Store {
  constructor(file) {
    this.file = file;
    this.data = { conversations: [] };
    this.saveTimer = null;
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.conversations)) {
        this.data = { conversations: parsed.conversations };
        for (const conversation of this.data.conversations) {
          if (!Array.isArray(conversation.messages)) conversation.messages = [];
        }
      }
    } catch (error) {
      console.error('[store] Could not read data file, starting empty:', error.message);
      this.data = { conversations: [] };
    }
  }

  createConversation({ visitorId, visitorName, page, userAgent }) {
    const now = new Date().toISOString();
    const conversation = {
      id: crypto.randomUUID(),
      visitorId,
      visitorName,
      page: page || '',
      userAgent: userAgent || '',
      createdAt: now,
      updatedAt: now,
      status: 'open',
      unreadForAgent: 0,
      unreadForVisitor: 0,
      messages: [],
    };
    this.data.conversations.push(conversation);
    this.saveSoon();
    return conversation;
  }

  getConversation(id) {
    return this.data.conversations.find((conversation) => conversation.id === id) || null;
  }

  findByVisitor(visitorId) {
    return (
      this.data.conversations.find((conversation) => conversation.visitorId === visitorId) || null
    );
  }

  addMessage(conversation, { role, text, authorName = '', clientId = '' }) {
    const message = {
      id: crypto.randomUUID(),
      role,
      text,
      at: new Date().toISOString(),
      authorName,
    };
    if (clientId) message.clientId = clientId;
    conversation.messages.push(message);
    if (conversation.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
      conversation.messages.splice(0, conversation.messages.length - MAX_MESSAGES_PER_CONVERSATION);
    }
    conversation.updatedAt = message.at;
    this.saveSoon();
    return message;
  }

  removeConversation(id) {
    const index = this.data.conversations.findIndex((conversation) => conversation.id === id);
    if (index === -1) return false;
    this.data.conversations.splice(index, 1);
    this.saveSoon();
    return true;
  }

  saveSoon() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 250);
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tempFile = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tempFile, this.file);
    } catch (error) {
      console.error('[store] Failed to save data:', error);
    }
  }
}

module.exports = { Store, MAX_MESSAGES_PER_CONVERSATION };
