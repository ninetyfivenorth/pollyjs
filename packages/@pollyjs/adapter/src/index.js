import isExpired from './utils/is-expired';

const REQUEST_HANDLER = Symbol();
const ACTIONS = {
  RECORD: 'record',
  REPLAY: 'replay',
  INTERCEPT: 'intercept',
  PASSTHROUGH: 'passthrough'
};

export default class Adapter {
  constructor(polly) {
    this.polly = polly;
    this.isConnected = false;
  }

  get persister() {
    return this.polly.persister;
  }

  connect() {
    if (!this.isConnected) {
      this.onConnect();
      this.isConnected = true;
    }
  }

  disconnect() {
    if (this.isConnected) {
      this.onDisconnect();
      this.isConnected = false;
    }
  }

  shouldReRecord(recordingEntry) {
    const { config } = this.polly;

    if (isExpired(recordingEntry.created_at, config.expiresIn)) {
      if (!config.recordIfExpired) {
        console.warn(
          '[Polly] Recording for the following request has expired but `recordIfExpired` is `false`.\n' +
            `${recordingEntry.request.method} ${recordingEntry.request.url}\n`,
          recordingEntry
        );

        return false;
      }

      if (!navigator.onLine) {
        console.warn(
          '[Polly] Recording for the following request has expired but the browser is offline.\n' +
            `${recordingEntry.request.method} ${recordingEntry.request.url}\n`,
          recordingEntry
        );

        return false;
      }

      return true;
    }

    return false;
  }

  timeout(pollyRequest, { request, response }) {
    const { timing } = this.polly.config;

    if (typeof timing === 'function') {
      return timing(request.timestamp, response.timestamp);
    }
  }

  handleRequest() {
    return this[REQUEST_HANDLER](...arguments);
  }

  async [REQUEST_HANDLER](request) {
    const { mode, Modes } = this.polly;
    const pollyRequest = this.polly.registerRequest(request);

    await pollyRequest.setup();

    if (mode === Modes.PASSTHROUGH || pollyRequest.shouldPassthrough) {
      return this.passthrough(pollyRequest);
    }

    if (pollyRequest.shouldIntercept) {
      return this.intercept(pollyRequest);
    }

    if (mode === Modes.RECORD) {
      return this.record(pollyRequest);
    }

    if (mode === Modes.REPLAY) {
      return this.replay(pollyRequest);
    }

    // This should never be reached. If it did, then something screwy happened.
    this.assert(
      `Unhandled request: ${pollyRequest.method} ${pollyRequest.url}.`,
      false
    );
  }

  async passthrough(pollyRequest) {
    pollyRequest.action = ACTIONS.PASSTHROUGH;

    return this.onPassthrough(pollyRequest);
  }

  async intercept(pollyRequest) {
    pollyRequest.action = ACTIONS.INTERCEPT;
    await pollyRequest._invoke('intercept', pollyRequest.response);

    return this.onIntercept(pollyRequest, pollyRequest.response);
  }

  async record(pollyRequest) {
    pollyRequest.action = ACTIONS.RECORD;

    return this.onRecord(pollyRequest);
  }

  async replay(pollyRequest) {
    const { config } = this.polly;
    const recordingEntry = await this.persister.findRecordingEntry(
      pollyRequest
    );

    if (recordingEntry) {
      await pollyRequest._trigger('beforeReplay', recordingEntry);

      if (this.shouldReRecord(recordingEntry)) {
        return this.record(pollyRequest);
      }

      await this.timeout(pollyRequest, recordingEntry);
      pollyRequest.action = ACTIONS.REPLAY;

      return this.onReplay(pollyRequest, recordingEntry);
    }

    if (config.recordIfMissing) {
      return this.record(pollyRequest);
    }

    this.assert(
      'Recording for the following request is not found and `recordIfMissing` is `false`.\n' +
        `${pollyRequest.method} ${pollyRequest.url}\n`,
      false
    );
  }

  assert(message, ...args) {
    this.polly.assert(`${this} ${message}`, ...args);
  }

  toString() {
    /* cannot use this.assert since `this` calls toString */
    this.polly.assert('Must implement the the `toString` hook.', false);
  }

  onConnect() {
    this.assert('Must implement the `onConnect` hook.', false);
  }

  onPassthrough() {
    this.assert('Must implement the `onPassthrough` hook.', false);
  }

  onIntercept() {
    this.assert('Must implement the `onIntercept` hook.', false);
  }

  onRecord() {
    this.assert('Must implement the `onRecord` hook.', false);
  }

  onReplay() {
    this.assert('Must implement the `onReplay` hook.', false);
  }

  onDisconnect() {
    this.assert('Must implement the `onDisconnect` hook.', false);
  }
}
