import { chat, chat_metadata } from '../script.js';
export const extension_settings = {};
export function getContext(){ return { chat, chatId:'mock-chat-1', chatMetadata: chat_metadata, characterId:0, characters:[{name:'莉娜', avatar:'lina.png'}], name1:'旅人', name2:'莉娜', groupId: undefined }; }
export function saveMetadataDebounced(){}
