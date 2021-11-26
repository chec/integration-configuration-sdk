import Postmate, { ChildAPI } from 'postmate';

/**
 * Represents the integration configuration that will eventually be saved against the integration record
 */
type Config = { [key: string]: any };

/**
 * Creates a type from a config type that removes any keys that don't have object type definitions, essentially just
 * leaving keys that contain sub-schemas
 */
type ConfigObjectTypes<T> = {
  [K in keyof T]: T[K] extends Config ? T[K] : never
};

/**
 * Extract keys of a given union type into a single type. This powers the `key` part of a schema definition, where the
 * "type" is essentially just an enum generated from the object keys of the configuration.
 */
type KeysOfUnion<T> = T extends T ? keyof T : never;

export enum SchemaFieldTypes {
  ShortText = 'short_text',
  LongText = 'long_text',
  Number = 'number',
  Wysiwyg = 'wysiwyg',
  Boolean = 'boolean',
  Select = 'select',
  Button = 'button',
  Link = 'link',
  ApiKey = 'api_key',
  Html = 'html',
  Password = 'Password',
}

interface KeyableSchemaItem<T = Config> {
  key: KeysOfUnion<T>
}

interface InputSchemaItem<InputType, T = Config> extends KeyableSchemaItem<T> {
  default?: InputType
  description?: string
  disabled?: boolean
  label: string
  required?: boolean
}

export interface TextSchemaItem<T = Config> extends InputSchemaItem<string, T> {
  type: SchemaFieldTypes.ShortText | SchemaFieldTypes.LongText | SchemaFieldTypes.Wysiwyg | SchemaFieldTypes.ApiKey | SchemaFieldTypes.Password
}

export interface NumberSchemaItem<T = Config> extends InputSchemaItem<number, T> {
  type: SchemaFieldTypes.Number,
}

export interface BooleanSchemaItem<T = Config> extends InputSchemaItem<boolean, T> {
  type: SchemaFieldTypes.Boolean,
}

export interface HtmlSchemaItem<T = Config> {
  type: SchemaFieldTypes.Html
  content: string
}

export interface ButtonSchemaItem {
  type: SchemaFieldTypes.Button
  // Note that "key" here does not reference a key in config like other items, but is given in an event payload
  key: string
  label: string
  disabled?: boolean
}

export interface LinkSchemaItem {
  type: SchemaFieldTypes.Link
  label: string
  href: string
}

export interface SelectSchemaItem<T = Config> extends InputSchemaItem<string | Array<string>, T> {
  type: SchemaFieldTypes.Select,
  multiselect?: boolean
  options: Array<{ value: string, label: string }>
}

export interface SubSchemaItem<T = Config> extends KeyableSchemaItem<T> {
  label: string
  description?: string
  schema: Schema<ConfigObjectTypes<T>[keyof T]>
}

export type UsableSchemaItems = TextSchemaItem | NumberSchemaItem | BooleanSchemaItem | HtmlSchemaItem
  | ButtonSchemaItem | LinkSchemaItem | SelectSchemaItem | SubSchemaItem;

export type Schema<T = Config> = Array<UsableSchemaItems>

/**
 * Represents an event relayed to the SDK from the dashboard
 */
interface DashboardEvent<T = Config> {
  event: string,
  field: KeyableSchemaItem<T> | ButtonSchemaItem | null,
  payload: any,
}

/**
 * The expected type of event handler used when registering event handlers with the SDK
 */
type EventHandler = (event: DashboardEvent) => void;

/**
 * Manages events broadcast from the dashboard and allows for attaching handlers to trigger from those events
 */
class EventBus {
  handlers: Array<EventHandler>

  constructor() {
    this.handlers = [];
  }

  pushHandler(handler: EventHandler) {
    this.handlers.push(handler);
  }

  trigger(event: DashboardEvent) {
    this.handlers.forEach((handler) => handler(event));
  }
}

/**
 * The expected type of handler used when registered events to handle changes in integration configuration
 */
type ConfigWatcher<T = Config> = (config: T) => void;

/**
 * Represents a connection with the Chec dashboard when this app is rendered within the Chec dashboard, and provides
 * API to community with the dashboard.
 */
export class ConfigSDK<T = Config> {
  parent: ChildAPI;
  eventBus: EventBus;
  config: T;
  configWatchers: Array<ConfigWatcher<T>>
  editMode: boolean

  constructor(childApi: ChildAPI, eventBus: EventBus) {
    this.parent = childApi;
    this.eventBus = eventBus;
    this.configWatchers = [];

    // Fill in some defaults provided by the dashboard through Postmate. The ts-ignores are here as the Postmate types
    // provided by the community don't include a definition for `childApi.model`, maybe because it's not completely
    // clear if this is intended to be a public API by Postmate.
    // @ts-ignore
    this.config = childApi.model.config || {};
    // @ts-ignore
    this.editMode = Boolean(childApi.model.editMode);

    this.eventBus.pushHandler((event: DashboardEvent) => {
      if (event.event !== 'set-config') {
        return;
      }

      this.config = event.payload;

      this.configWatchers.forEach((watcher) => watcher(this.config));
    })
  }

  /**
   * Watches for changes to the content height of the app, and updates the Chec dashboard so that the frame height
   * will match the size of the content in the frame
   *
   * Returns a function that will disable the resize watcher for appropriate clean up.
   */
  enableAutoResize(): () => void {
    if (!document || !document.body) {
      throw new Error('Auto-resize can only be enabled when a document (and body) is present');
    }

    // Extract height calculation logic into a reusable closure
    const calculateHeight = () => {
      const rect = document.body.getBoundingClientRect();
      return rect.y + rect.height;
    }

    // Create a resize observer to watch changes in body height
    const observer = new ResizeObserver(() => {
      this.setHeight(calculateHeight());
    });
    observer.observe(document.body);

    // Broadcast an initial height
    this.setHeight(calculateHeight());

    // Return a cleanup function in-case for usage with APIs that support cleanup (eg. React useEffect)
    return () => {
      observer.disconnect();
    }
  }

  /**
   * Get the current config set by the user in the dashboard
   */
  getConfig(): T {
    return this.config;
  }

  /**
   * Watch for events on fields that are rendered by the Chec dashboard. Right now this only supports buttons
   *
   * @param {string} event The event name to watch for (eg. "click")
   * @param {string} key The key of the field that the event will be triggered on (eg. "my_button")
   * @param {Function} handler The function to run when the given event is fired on the given field.
   */
  on(event: string, key: string, handler: Function) {
    this.eventBus.pushHandler((candidateEvent: DashboardEvent) => {
      if (
        candidateEvent.event === event
        && candidateEvent.field
        && candidateEvent.field.key === key
      ) {
        handler();
      }
    })
  }

  /**
   * Register a function to run when configuration changes
   */
  onConfigUpdate(handler: ConfigWatcher<T>) {
    this.configWatchers.push(handler);
  }

  /**
   * Set the height of the frame in the Chec dashboard so that it will display all the content rendered by the app
   */
  setHeight(height: number): void {
    this.parent.emit('set-height', height.toString());
  }

  /**
   * Update configuration of the integration by providing an object with values that will be merged with the existing
   * configuration.
   *
   * Note the configuration is not deeply merged.
   */
  setConfig(config: T): void {
    this.parent.emit('save', config);
  }

  /**
   * Update the form schema that the Chec dashboard will use to render a configuration form to the user.
   *
   * This function is implemented as a typescript generic to facilitate type safety on just this function, if using the
   * default generic definition of this class.
   */
  setSchema<OverrideType extends T>(schema: Schema<OverrideType>): void {
    this.parent.emit('set-schema', schema);
  }
}

/**
 * Establish a connection to the Chec dashboard, and return an instance of the ConfigSDK class to provide API to
 * communicate with the dashboard.
 */
export async function createSDK<T = Config>(): Promise<ConfigSDK<T>> {
  // Create an event bus to handle events
  const bus = new EventBus();

  return new ConfigSDK(
    await new Postmate.Model({
      // Declare the "event" API that the dashboard can call to register events
      event(event: DashboardEvent) {
        bus.trigger(event);
      }
    }),
    bus
  );
}
