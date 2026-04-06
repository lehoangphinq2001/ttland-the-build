/* eslint-disable prettier/prettier */
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Geometry } from 'geojson';

@Entity()
export class FileLayerLine {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 155 })
  filename: string;

  @Column({ length: 55, nullable: true })
  extension: string;

  @Column({ length: 255, nullable: true })
  sub_address: string;

  @Column({ length: 255 })
  fullname: string; //

  @Column()
  accountId: number;

  @Column({ nullable: true })
  provinceId: string;

  @Column({ nullable: true })
  districtId: string;

  @Column({ nullable: true })
  wardId: string;

  // ============================
  @Column({ nullable: true })
  provinceNewId: string;

  @Column({ nullable: true })
  wardNewId: string;

  @Column({ type: 'geometry', nullable: true })
  geom: Geometry;

  // ============================
  @Column({ nullable: true })
  year: number;

  @Column({ length: 255, nullable: true })
  note: string;

  @Column({ nullable: true })
  ssn: boolean;

  @Column({ nullable: true, length: 15 })
  status: string;

  @UpdateDateColumn()
  updated_at: Date;
}
