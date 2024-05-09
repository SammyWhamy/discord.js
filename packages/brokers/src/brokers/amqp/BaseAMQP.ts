import { AsyncEventEmitter } from '@vladfrangu/async_event_emitter';
import type { Channel, ConsumeMessage } from 'amqplib';
import type { BaseBrokerOptions, IBaseBroker, ToEventMap } from '../Broker.js';
import { DefaultBrokerOptions } from '../Broker.js';

/**
 * Options specific for an AMQP broker
 */
export interface AMQPBrokerOptions extends BaseBrokerOptions {
	/**
	 * The AMQP connection to use
	 */
	amqpChannel: Channel;

	/**
	 * The exchange to use for this broker, if left empty the default exchange will be used
	 */
	exchange?: string;
}

/**
 * Helper class with shared AMQP logic
 */
export abstract class BaseAMQPBroker<TEvents extends Record<string, any>>
	extends AsyncEventEmitter<ToEventMap<TEvents>>
	implements IBaseBroker<TEvents>
{
	/**
	 * Options this broker is using
	 */
	protected readonly options: Required<AMQPBrokerOptions>;

	/**
	 * Events this broker has subscribed to
	 */
	protected readonly subscribedEvents = new Set<string>();

	/**
	 * Whether this broker is currently polling events
	 */
	protected listening = false;

	public constructor(options: AMQPBrokerOptions) {
		super();

		options.amqpChannel = options.amqpChannel ?? '';
		this.options = { ...DefaultBrokerOptions, ...(options as Required<AMQPBrokerOptions>) };
	}

	/**
	 * {@inheritDoc IBaseBroker.subscribe}
	 */
	public async subscribe(group: string, events: (keyof TEvents)[]): Promise<void> {
		if (this.options.exchange) {
			await this.options.amqpChannel.assertExchange(this.options.exchange, 'direct');
		}

		await Promise.all(
			events.map(async (event) => {
				this.subscribedEvents.add(event as string);
				const queueName = `${group}_${event as string}`;
				await this.options.amqpChannel.assertQueue(queueName);
				if (this.options.exchange) {
					await this.options.amqpChannel.bindQueue(queueName, this.options.exchange, event as string);
				}
			}),
		);

		void this.listen(group, events);
	}

	/**
	 * {@inheritDoc IBaseBroker.unsubscribe}
	 */
	public async unsubscribe(group: string, events: (keyof TEvents)[]): Promise<void> {
		await Promise.all(
			events.map(async (event) => {
				this.subscribedEvents.delete(event as string);
				const queueName = `${group}_${event as string}`;
				if (this.options.exchange) {
					await this.options.amqpChannel.unbindQueue(queueName, this.options.exchange, event as string);
				}
			}),
		);
	}

	/**
	 * Begins polling for events, firing them to {@link BaseRedisBroker.listen}
	 */
	protected async listen(group: string, events: (keyof TEvents)[]): Promise<void> {
		if (this.listening) {
			return;
		}

		this.listening = true;

		this.options.amqpChannel.on('error', (error) => {
			this.emit('error', error);
		});

		this.options.amqpChannel.on('close', () => {
			this.listening = false;
		});

		await Promise.all(
			events.map(async (event) => {
				const queueName = `${group}_${event as string}`;
				await this.options.amqpChannel.consume(queueName, (message) => {
					if (!message) {
						return;
					}

					this.emitEvent(event as string, message);
				});
			}),
		);
	}

	/**
	 * Destroys the broker, closing all connections
	 */
	public async destroy(): Promise<void> {
		await this.options.amqpChannel.close();
	}

	/**
	 * Handles an incoming AMQP event
	 */
	protected abstract emitEvent(event: string, data: ConsumeMessage): void;
}
