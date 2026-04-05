import mongoose, { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { indexRunStatuses, type IndexRunStatus } from '../../shared/types/domain.js';

export interface IndexRunErrorRecord {
  filePath?: string;
  message: string;
}

export interface IndexRunRecord {
  repoId: Types.ObjectId;
  startedAt: Date;
  finishedAt?: Date;
  scannedFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  errors: IndexRunErrorRecord[];
  status: IndexRunStatus;
}

export type IndexRunDocument = HydratedDocument<IndexRunRecord>;

const indexRunErrorSchema = new Schema<IndexRunErrorRecord>(
  {
    filePath: {
      type: String
    },
    message: {
      type: String,
      required: true
    }
  },
  {
    _id: false
  }
);

const indexRunSchema = new Schema<IndexRunRecord>(
  {
    repoId: {
      type: Schema.Types.ObjectId,
      ref: 'Repository',
      required: true,
      index: true
    },
    startedAt: {
      type: Date,
      required: true
    },
    finishedAt: {
      type: Date
    },
    scannedFiles: {
      type: Number,
      required: true,
      default: 0
    },
    indexedFiles: {
      type: Number,
      required: true,
      default: 0
    },
    skippedFiles: {
      type: Number,
      required: true,
      default: 0
    },
    errors: {
      type: [indexRunErrorSchema],
      default: []
    },
    status: {
      type: String,
      enum: indexRunStatuses,
      required: true,
      default: 'running'
    }
  },
  {
    timestamps: true,
    versionKey: false,
    suppressReservedKeysWarning: true
  }
);

indexRunSchema.index({ repoId: 1, startedAt: -1 });
indexRunSchema.index(
  { repoId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'running'
    }
  }
);

export const IndexRunModel: Model<IndexRunRecord> =
  (mongoose.models.IndexRun as Model<IndexRunRecord> | undefined) ??
  model<IndexRunRecord>('IndexRun', indexRunSchema);
