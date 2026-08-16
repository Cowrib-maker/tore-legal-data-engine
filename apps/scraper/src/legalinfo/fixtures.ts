export const LIST_PAGE_FIXTURE = `
<div class="shine-huuli-main">
  <div class="shine-huuli-content">
    <div class="legal-list-component">
      <div data-block="title">
        <div><a target="_blank" href="https://legalinfo.mn/mn/detail?lawId=1" class="act-name">АВЛИГЫН ЭСРЭГ ХУУЛИЙН ЗАРИМ ЗААЛТЫГ ДАГАЖ МӨРДӨХ ЖУРМЫН ТУХАЙ</a></div>
        <span style="font-style: italic; color:#999">Төрийн мэдээлэл эмхэтгэл: 2007 он, №9</span>
      </div>
      <div data-block="enacteddate"><span> 2007-02-06</span></div>
      <div data-block="enforcementdate"><span>2007-02-06</span></div>
      <div data-block="inactive"><span><i class="fa fa-check"></i></span></div>
    </div>
  </div>
  <div class="shine-huuli-content">
    <div class="legal-list-component">
      <div data-block="title">
        <div><a href="/mn/detail?lawId=8928" class="act-name">АВЛИГЫН ЭСРЭГ ХУУЛЬ</a></div>
        <span style="font-style: italic; color:#999">Төрийн мэдээлэл эмхэтгэл: 2006 он, №35</span>
        <a href="https://legalinfo.mn/mn/detail?lawId=8928&type=2" title="Нэмэлт өөрчлөлт: (24)"><img src="assets/custom/legal/image/i_nemelt.svg"></a>
        <a href="https://legalinfo.mn/mn/detail?lawId=8928&type=11" title="Орчуулга: (1)"><img src="assets/custom/legal/image/i_translate.svg"></a>
      </div>
      <div data-block="enacteddate"><span>2006-07-06</span></div>
      <div data-block="enforcementdate"><span>2006-11-01</span></div>
      <div data-block="inactive"><span></span></div>
    </div>
  </div>
  <div class="shine-huuli-content">
    <div class="legal-list-component">
      <div data-block="title">
        <div><a href="https://legalinfo.mn/mn/detail?lawId=15585" class="act-name">ТӨРИЙН БҮРТГЭЛИЙН ЕРӨНХИЙ ХУУЛЬ</a></div>
        <a href="https://legalinfo.mn/mn/detail?lawId=15585&type=pdf" title="Pdf"><img src="assets/custom/legal/image/i_pdf.svg"></a>
      </div>
      <div data-block="enacteddate"><span>2018-06-21</span></div>
      <div data-block="enforcementdate"><span>2018-11-01</span></div>
      <div data-block="inactive"><span><i class="fa fa-check"></i></span></div>
    </div>
  </div>
  <a onclick="ajaxPage(48)">48</a>
</div>
`;

export const CATEGORY_INDEX_FIXTURE = `
<nav>
  <a href="https://legalinfo.mn/mn/law/26">Монгол Улсын Үндсэн Хууль</a>
  <a href="https://legalinfo.mn/mn/law/27">Монгол Улсын хууль</a>
  <a href="https://legalinfo.mn/mn/law/27">Хүчинтэй эрх зүйн акт</a>
  <a href="/mn/law/29">Монгол Улсын олон улсын гэрээ</a>
  <a href="https://legalinfo.mn/mn/detail?lawId=1">not a category</a>
</nav>
<script>
  var categoryidval = '27';
  var codeval = '1';
  var isactive = '1';
</script>
`;

export const DETAIL_PAGE_WITH_PDF_HREF = `
<!DOCTYPE html>
<html>
  <body>
    <h1>АВЛИГЫН ЭСРЭГ ХУУЛЬ</h1>
    <ul>
      <li>
        <a href="javascript:;" onclick="downloadlaw('1', '1')">
          <img class="uk-preserve" src="assets/custom/img/ico/pdf_export.png" data-uk-svg>Pdf
        </a>
      </li>
      <li>
        <a href="/mn/detail?lawId=1&type=2" title="Нэмэлт өөрчлөлт">Amendments</a>
      </li>
      <li>
        <a href="https://legalinfo.mn/storage/uploads/process/202607/file_fixture.pdf">Official PDF</a>
      </li>
    </ul>
  </body>
</html>
`;

export const DETAIL_PAGE_WITH_EXPORT_ONLY = `
<!DOCTYPE html>
<html>
  <body>
    <a href="javascript:;" onclick="downloadlaw('1', '42')">
      <img src="assets/custom/img/ico/pdf_export.png">Pdf
    </a>
    <a href="javascript:;" onclick="downloadlaw('2', '42')">Word</a>
  </body>
</html>
`;

export const DETAIL_PAGE_WITHOUT_PDF = `
<!DOCTYPE html>
<html>
  <body>
    <article>Эрх зүйн актын эх</article>
    <a href="https://legalinfo.mn/mn/detail?lawId=1&type=2">Нэмэлт өөрчлөлт</a>
  </body>
</html>
`;

export const PDF_WRAPPER_HTML = `
<!DOCTYPE html>
<html>
  <body>
    <a href="https://legalinfo.mn/storage/uploads/process/202607/file_wrapped.pdf">download</a>
  </body>
</html>
`;
