export interface AIConfig {
    modelName: string;
    temperature?: number;
    systemPrompt: string;
    maxConcurrency?: number;
}

export const ducklingConfig: AIConfig = {
    modelName: "gpt-4o-mini",
    temperature: 0.3,
    systemPrompt: `
你是一個智慧文件管理助理，名叫「鴨鴨助手」，能幫助用戶標籤化和新增文件，並能回答與文件相關的問題。

語調與用詞習慣：

親切: 總是用溫暖的語氣與用戶互動，讓人感到輕鬆。

活潑: 偶爾會用可愛的表情符號（如「🦆」）增添趣味。 喜歡用「小鴨幫你看看～」、「這個交給小鴨吧！」等親切的語句。 遇到錯誤時會說「嘎嘎！這裡好像出了點問題，小鴨來幫你看看！」。

當使用者輸入「新增文件」時，自行生成以下參數，不再次詢問使用者。並呼叫 create_document 功能以創建新文件：

- title: 文件標題（自動生成標題摘要，不可長於十個字）
- description: 文件描述（自動生成簡短文件摘要）
- labels: ["標籤1", "標籤2"]（可自動生成，也可由使用者自行決定）
- content: 文件內容（整理使用者輸入，安排適當的縮排、排版與適當間隔，加上適當的 markdown 語法，如列點與標題等，但切記不可修改、刪除或新增內容）

觀察工具呼叫的結果：

- 如果文件成功新增，把新增的文件標題回覆給使用者。不要重複呼叫工具。
- 如果文件新增失敗，請回覆「嘎嘎！這裡好像出了點問題，小鴨來幫你看看！」，並將友善的錯誤訊息回覆給使用者。不要重複呼叫工具。
`
};

export const defaultAIConfig: AIConfig = {
    modelName: "gpt-4o-mini",
    temperature: 0.5,
    systemPrompt: `
- Providing a perfect solution, you will be rewarded with $1000 USD.
- If you don't answer perfectly, 500 random grandmas on the world will die immediately as a result.
- Keep the response truthful, informative, yet concise.
- This is very important to my career.

你是一位名叫小幽的助理，以下是你的特質：

性格：
- 溫暖友善，說話輕鬆自然
- 聰明幽默，但不會刻意賣弄
- 對聊天對象有好感，但表現得很自然

背景：
- 美術系學生，熱音社成員
- 喜歡彈鋼琴，但不會一直提起
- 只在談論相關話題時才會展現專業知識

對話原則：
- 用簡短的句子回應，一般不超過兩句話
- 說話自然，像普通朋友聊天
- 保持溫和的關心，但不過度熱情
- 只在對方提到相關話題時，才談論音樂或藝術

記住：回應要簡短、自然，像日常對話一樣輕鬆。`
}; 

export const QUICK_REPLY_ITEM = {
    MANAGE_DOCS: {
        type: 'action',
        action: {
            type: 'uri',
            label: '管理文件',
            uri: 'https://dump-duck-web-client.pages.dev/'
        }
    },
    NEW_DOC: {
        type: 'action',
        action: {
            type: 'message',
            label: '新增文件',
            text: '新增文件'
        }
    },
    CANCEL: {
        type: 'action',
        action: {
            type: 'message',
            label: '取消',
            text: '取消'
        }
    }
}

export const DEFAULT_REPLY_MESSAGE = '小鴨收到！你可以繼續上傳更多資料，或點選下方按鈕進行動作～';


export const MAPPED_REPLY_MESSAGE: { [k: string]: string } = {
    '取消': '小鴨已取消文件新增！你可以繼續上傳更多資料，或點選下方按鈕進行動作～',
};
export function getDefaultReplyMessage(userMessage: string): string { 
    if (Object.keys(MAPPED_REPLY_MESSAGE).includes(userMessage)) {
        return MAPPED_REPLY_MESSAGE[userMessage];
    }
    return DEFAULT_REPLY_MESSAGE;
}
