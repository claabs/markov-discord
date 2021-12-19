/* eslint-disable import/no-cycle */
import { PrimaryColumn, Entity, ManyToOne, BaseEntity, Column } from 'typeorm';
import { Guild } from './Guild';

@Entity()
export class Channel extends BaseEntity {
  @PrimaryColumn()
  id: string;

  @Column({
    default: true,
  })
  listen: boolean;

  @ManyToOne(() => Guild, (guild) => guild.channels)
  guild: Guild;
}
