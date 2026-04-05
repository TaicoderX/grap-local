import mongoose, { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface FileDocumentRecord {
  repoId: Types.ObjectId;
  path: string;
  extension: string;
  contentHash: string;
  lastModifiedAt: Date;
  indexedAt?: Date;
  symbolIds: Types.ObjectId[];
  importPaths: string[];
  textPreview?: string;
}

export type FileDocumentDocument = HydratedDocument<FileDocumentRecord>;

const fileDocumentSchema = new Schema<FileDocumentRecord>(
  {
    repoId: {
      type: Schema.Types.ObjectId,
      ref: 'Repository',
      required: true,
      index: true
    },
    path: {
      type: String,
      required: true
    },
    extension: {
      type: String,
      required: true
    },
    contentHash: {
      type: String,
      required: true
    },
    lastModifiedAt: {
      type: Date,
      required: true
    },
    indexedAt: {
      type: Date
    },
    symbolIds: {
      type: [Schema.Types.ObjectId],
      ref: 'SymbolDocument',
      default: []
    },
    importPaths: {
      type: [String],
      default: []
    },
    textPreview: {
      type: String
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

fileDocumentSchema.index({ repoId: 1, path: 1 }, { unique: true });
fileDocumentSchema.index({ repoId: 1, indexedAt: -1 });
fileDocumentSchema.index({ repoId: 1, importPaths: 1 });

export const FileDocumentModel: Model<FileDocumentRecord> =
  (mongoose.models.FileDocument as Model<FileDocumentRecord> | undefined) ??
  model<FileDocumentRecord>('FileDocument', fileDocumentSchema);
