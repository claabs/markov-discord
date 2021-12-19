/* eslint-disable import/no-cycle */
import { BaseEntity, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { Channel } from './Channel';

@Entity()
export class Guild extends BaseEntity {
  @PrimaryColumn()
  id: string;

  @OneToMany(() => Channel, (channel) => channel.guild, { onDelete: 'CASCADE', cascade: true })
  channels: Channel[];
}
