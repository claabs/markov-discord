import {MigrationInterface, QueryRunner} from "typeorm";

export class CreateTables1640838214672 implements MigrationInterface {
    name = 'CreateTables1640838214672'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "guild" ("id" text PRIMARY KEY NOT NULL)`);
        await queryRunner.query(`CREATE TABLE "channel" ("id" text PRIMARY KEY NOT NULL, "listen" boolean NOT NULL DEFAULT (0), "guildId" text)`);
        await queryRunner.query(`CREATE TABLE "temporary_channel" ("id" text PRIMARY KEY NOT NULL, "listen" boolean NOT NULL DEFAULT (0), "guildId" text, CONSTRAINT "FK_58d968d578e6279e2cc884db403" FOREIGN KEY ("guildId") REFERENCES "guild" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_channel"("id", "listen", "guildId") SELECT "id", "listen", "guildId" FROM "channel"`);
        await queryRunner.query(`DROP TABLE "channel"`);
        await queryRunner.query(`ALTER TABLE "temporary_channel" RENAME TO "channel"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "channel" RENAME TO "temporary_channel"`);
        await queryRunner.query(`CREATE TABLE "channel" ("id" text PRIMARY KEY NOT NULL, "listen" boolean NOT NULL DEFAULT (0), "guildId" text)`);
        await queryRunner.query(`INSERT INTO "channel"("id", "listen", "guildId") SELECT "id", "listen", "guildId" FROM "temporary_channel"`);
        await queryRunner.query(`DROP TABLE "temporary_channel"`);
        await queryRunner.query(`DROP TABLE "channel"`);
        await queryRunner.query(`DROP TABLE "guild"`);
    }

}
