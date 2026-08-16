export const LIST_PAGE_FIXTURE = `
<div class="shine-huuli-main">
  <div class="shine-huuli-content">
    <div class="legal-list-component">
      <div data-block="title">
        <div><a href="https://legalinfo.mn/mn/detail?lawId=1" class="act-name">АВЛИГЫН ЭСРЭГ ХУУЛЬ</a></div>
      </div>
    </div>
  </div>
  <div class="shine-huuli-content">
    <div class="legal-list-component">
      <div data-block="title">
        <div><a href="/mn/detail?lawId=1622" class="act-name">ЭРҮҮГИЙН ХУУЛЬ</a></div>
      </div>
    </div>
  </div>
</div>
`;

export const LAW_HTML_FIXTURE = `<!DOCTYPE html>
<html>
  <head><title>ЭРҮҮГИЙН ХУУЛЬ</title></head>
  <body>
    <h1>ЭРҮҮГИЙН ХУУЛЬ</h1>
    <p>Батлагдсан: 2015-12-03</p>
    <p>Хүчин төгөлдөр: 2017-07-01</p>
    <p>1 дүгээр зүйл. Хуулийн зорилт</p>
    <p>1. Энэ хуулийн зорилт нь гэмт явдлаас урьдчилан сэргийлэхэд оршино.</p>
    <p>1.1. Нэгдүгээр заалт.</p>
    <p>1.2. Хоёрдугаар заалт.</p>
    <p>2. Хоёр дахь хэсэг.</p>
    <p>2 дугаар зүйл. Хамрах хүрээ</p>
    <p>1. Энэ хууль Монгол Улсын нутаг дэвсгэрт хамаарна.</p>
    <p>17 дугаар зүйл. Хүний амьд явах эрх</p>
    <p>1. Хүний амь насыг хорихыг хориглоно.</p>
  </body>
</html>`;

export const MALFORMED_HTML_FIXTURE = `<!DOCTYPE html>
<html>
  <body>
    <div>random page without provisions</div>
  </body>
</html>`;
