import type { ConsumeMessage } from 'amqplib';
import type { IPubSubBroker } from '../Broker.js';
import { BaseAMQPBroker } from './BaseAMQP.js';

/**
 * PubSub broker powered by AMQP
 *
 * @example
 * ```ts
 * // publisher.js
 * import { PubSubAMQPBroker } from '@discordjs/brokers';
 * import { connect } from 'amqplib';
 *
 * const connection = await connect('amqp://localhost');
 * const channel = await connection.createChannel();
 *
 * const broker = new PubSubAMQPBroker({ amqpChannel: channel, exchange: 'test' });
 *
 * await broker.publish('test', 'Hello World!');
 * await broker.destroy();
 *
 * // subscriber.js
 * import { PubSubAMQPBroker } from '@discordjs/brokers';
 * import { connect } from 'amqplib';
 *
 * const connection = await connect('amqp://localhost');
 * const channel = await connection.createChannel();
 *
 * const broker = new PubSubAMQPBroker({ amqpChannel: channel, exchange: 'test' });
 *
 * broker.on('test', ({ data, ack }) => {
 *   console.log(data);
 *   void ack();
 * });
 *
 * await broker.subscribe('subscribers', ['test']);
 * ```
 */
export class PubSubAMQPBroker<TEvents extends Record<string, any>>
	extends BaseAMQPBroker<TEvents>
	implements IPubSubBroker<TEvents>
{
	/**
	 * {@inheritDoc IPubSubBroker.publish}
	 */
	public async publish<Event extends keyof TEvents>(event: Event, data: TEvents[Event]): Promise<void> {
		this.options.amqpChannel.publish(this.options.exchange, event as string, this.options.encode(data));
	}

	protected emitEvent(event: string, message: ConsumeMessage) {
		const payload: { ack(): void; data: unknown } = {
			data: this.options.decode(message.content),
			ack: async () => {
				this.options.amqpChannel.ack(message);
			},
		};

		this.emit(event, payload);
	}
}
