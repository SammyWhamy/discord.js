import { randomUUID } from 'node:crypto';
import { clearTimeout, setTimeout } from 'node:timers';
import type { ConsumeMessage } from 'amqplib';
import type { IRPCBroker } from '../Broker.js';
import { DefaultBrokerOptions } from '../Broker.js';
import type { AMQPBrokerOptions } from './BaseAMQP.js';
import { BaseAMQPBroker } from './BaseAMQP.js';

/**
 * Options specific for an RPC AMQP broker
 */
export interface RPCAMQPBrokerOptions extends AMQPBrokerOptions {
	timeout?: number;
}

/**
 * Default values used for the {@link RPCAMQPBrokerOptions}
 */
export const DefaultRPCAMQPBrokerOptions = {
	...DefaultBrokerOptions,
	timeout: 5_000,
} as const;

/**
 * RPC broker powered by AMQP
 *
 * @example
 * ```ts
 * // caller.js
 * import { RPCAMQPBroker } from '@discordjs/brokers';
 * import { connect } from 'amqplib';
 *
 * const connection = await connect('amqp://localhost');
 * const channel = await connection.createChannel();
 *
 * const broker = new RPCAMQPBroker({ amqpChannel: channel, exchange: 'test' });
 *
 * console.log(await broker.call('testcall', 'Hello World!'));
 * await broker.destroy();
 *
 * // responder.js
 * import { RPCAMQPBroker } from '@discordjs/brokers';
 * import { connect } from 'amqplib';
 *
 * const connection = await connect('amqp://localhost');
 * const channel = await connection.createChannel();
 *
 * const broker = new RPCAMQPBroker({ amqpChannel: channel, exchange: 'test' });
 *
 * broker.on('testcall', ({ data, ack, reply }) => {
 * 	console.log('responder', data);
 * 	void ack();
 * 	void reply(`Echo: ${data}`);
 * });
 *
 * await broker.subscribe('responders', ['testcall']);
 */
export class RPCAMQPBroker<TEvents extends Record<string, any>, TResponses extends Record<keyof TEvents, any>>
	extends BaseAMQPBroker<TEvents>
	implements IRPCBroker<TEvents, TResponses>
{
	/**
	 * Options this broker is using
	 */
	protected override readonly options: Required<RPCAMQPBrokerOptions>;

	public constructor(options: RPCAMQPBrokerOptions) {
		super(options);

		options.amqpChannel = options.amqpChannel ?? '';
		this.options = { ...DefaultRPCAMQPBrokerOptions, ...(options as Required<RPCAMQPBrokerOptions>) };
	}

	/**
	 * {@inheritDoc IRPCBroker.call}
	 */
	public async call<Event extends keyof TEvents>(
		event: Event,
		data: TEvents[Event],
		timeoutDuration: number = this.options.timeout,
	): Promise<TResponses[Event]> {
		const { queue } = await this.options.amqpChannel.assertQueue('', { exclusive: true });
		const correlationId = randomUUID();

		// Construct the error here for better stack traces
		const timedOut = new Error(`timed out after ${timeoutDuration}ms`);

		return new Promise<TResponses[Event]>((resolve, reject) => {
			const timeout = setTimeout(() => reject(timedOut), timeoutDuration).unref();

			void this.options.amqpChannel.consume(
				queue,
				(message) => {
					if (message?.properties.correlationId === correlationId) {
						resolve(this.options.decode(message.content) as TResponses[Event]);
						clearTimeout(timeout);
					}
				},
				{
					noAck: true,
				},
			);

			this.options.amqpChannel.publish(this.options.exchange, event as string, this.options.encode(data), {
				replyTo: queue,
				correlationId,
			});
		});
	}

	protected emitEvent(event: string, message: ConsumeMessage) {
		const payload: { ack(): Promise<void>; data: unknown; reply(data: unknown): Promise<void> } = {
			data: this.options.decode(message.content),
			ack: async () => {
				this.options.amqpChannel.ack(message);
			},
			reply: async (data) => {
				this.options.amqpChannel.sendToQueue(message.properties.replyTo, this.options.encode(data), {
					correlationId: message.properties.correlationId,
				});
			},
		};

		this.emit(event, payload);
	}
}
