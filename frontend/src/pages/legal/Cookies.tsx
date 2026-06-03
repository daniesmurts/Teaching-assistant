import LegalLayout from '../../components/layout/LegalLayout'

export default function Cookies() {
  return (
    <LegalLayout title="Политика использования Cookie" lastUpdated="2 Июня 2026">
      <h2 className="text-xl font-display font-bold text-ink mt-8 mb-4">1. Что такое файлы cookie</h2>
      <p>
        Файлы cookie — это небольшие текстовые файлы, которые сохраняются на вашем устройстве (компьютере, планшете, смартфоне) при посещении сайта. Они позволяют сайту запоминать ваши действия и предпочтения.
      </p>
      
      <h2 className="text-xl font-display font-bold text-ink mt-8 mb-4">2. Как мы используем cookie</h2>
      <p>
        В сервисе ИСПУМ файлы cookie и локальные хранилища данных (LocalStorage) используются исключительно для:
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li><strong>Авторизации:</strong> сохранения состояния входа в систему (JWT токен хранится в `ga_token`), чтобы вам не приходилось вводить пароль при каждом посещении.</li>
          <li><strong>Базовой аналитики:</strong> для понимания того, как вы взаимодействуете с Сервисом, чтобы мы могли улучшать его работу.</li>
        </ul>
      </p>

      <h2 className="text-xl font-display font-bold text-ink mt-8 mb-4">3. Управление cookie</h2>
      <p>
        Вы можете настроить свой браузер так, чтобы он отказывался от всех файлов cookie или предупреждал об их отправке. Однако, если вы не принимаете файлы cookie или очищаете локальное хранилище, вы не сможете использовать большинство функций Сервиса (например, вы не сможете авторизоваться).
      </p>

      <h2 className="text-xl font-display font-bold text-ink mt-8 mb-4">4. Контакты</h2>
      <p>
        По всем вопросам использования cookie обращайтесь к Администратору:<br/>
        ИП Бугембе Даниел (ИНН 165510859142)<br/>
        Email: daniel@boadtech.com
      </p>
    </LegalLayout>
  )
}
