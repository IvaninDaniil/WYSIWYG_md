export type TreeNode = {
  name: string;
  path: string;
  kind: "folder" | "file";
  fileType?: "md" | "puml";
  children?: TreeNode[];
};

export type FilePayload = {
  path: string;
  kind: "md" | "puml";
  content: string;
};
