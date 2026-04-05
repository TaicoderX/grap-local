import mongoose, { model, Schema, type HydratedDocument, type Model } from 'mongoose';

import {
  repositoryStatuses,
  supportedLanguageHints,
  type LanguageHint,
  type RepositoryStatus
} from '../../shared/types/domain.js';

export interface RepositoryRecord {
  name: string;
  rootPath: string;
  languageHints: LanguageHint[];
  lastIndexedAt?: Date;
  status: RepositoryStatus;
}

export type RepositoryDocument = HydratedDocument<RepositoryRecord>;

const repositorySchema = new Schema<RepositoryRecord>(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    rootPath: {
      type: String,
      required: true,
      unique: true
    },
    languageHints: {
      type: [String],
      enum: supportedLanguageHints,
      default: ['typescript', 'javascript']
    },
    lastIndexedAt: {
      type: Date
    },
    status: {
      type: String,
      enum: repositoryStatuses,
      default: 'pending'
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

repositorySchema.index({ status: 1, lastIndexedAt: -1 });
repositorySchema.index({ name: 1 });

export const RepositoryModel: Model<RepositoryRecord> =
  (mongoose.models.Repository as Model<RepositoryRecord> | undefined) ??
  model<RepositoryRecord>('Repository', repositorySchema);
